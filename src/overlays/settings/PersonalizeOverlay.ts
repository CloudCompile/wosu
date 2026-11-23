import { Container, Graphics, type Text } from 'pixi.js';
import type { Game } from '../../app/Game';
import { Overlay } from '../../app/Overlay';
import { runBenchmark, type BenchmarkProgress, type BenchmarkReport } from '../../bench/suite';
import { CPU_WORKLOADS } from '../../bench/cpu';
import { SCENE_SCALES, sceneId } from '../../bench/gpu';
import { formatMs, formatRate, round } from '../../bench/stats';
import { Button } from '../../ui/Button';
import { Box } from '../../ui/Box';
import { ScrollContainer } from '../../ui/ScrollContainer';
import { label } from '../../ui/text';
import { ColorProvider, Colors, Metrics } from '../../ui/theme';
import { UIComponent } from '../../ui/UIComponent';
import { tween } from '../../core/Tweener';
import type { Action } from '../../input/bindings';
import type { GraphicsValues } from '../../settings/GraphicsPreset';
import { benchmarkToStorage, formatAge, loadBenchmark, saveBenchmark, type StoredBenchmark } from '../../settings/benchmarkStore';
import { describeTiers, deviceHints, gpuNameOf } from '../../settings/deviceTiers';

const colors = new ColorProvider('purple');
const CARD_W = 720;
const CARD_MAX_H = 640;
const HEADER = 92;
const FOOTER = 62;
const PAD = 22;

const ROW_HEIGHT = 46;

/** One test's line in the list: name, a sparkline, and the live result. */
class BenchRow extends UIComponent {
    private readonly titleText: Text;
    private readonly value: Text;
    private readonly bar = new Graphics();
    private readonly spark = new Graphics();
    private state: 'pending' | 'running' | 'done' | 'failed' = 'pending';
    private samples: number[] = [];
    private max = 0;

    constructor(readonly id: string, title: string, detail: string) {
        super();
        this.titleText = label(title, { size: 14, weight: '700', color: Colors.grayE });
        this.titleText.y = 2;
        this.detail = label(detail, { size: 11, weight: '500', color: Colors.gray9 });
        this.value = label('waiting', { size: 12, weight: '600', color: Colors.gray9 });
        this.value.anchor.set(1, 0);
        this.addChild(this.titleText, this.detail, this.bar, this.spark, this.value);
        this.resize(Metrics.settingsWidth + 180, ROW_HEIGHT);
    }

    private readonly detail: Text;

    protected override onResize(w: number, h: number): void {
        this.detail.y = h - 17;
        this.value.x = w - 4;
        this.value.y = 2;
        this.bar.clear().roundRect(0, h - 58, w, 3, 1.5).fill({ color: 0x000000, alpha: 0.25 });
        this.spark.x = w - 132;
        this.spark.y = h - 34;
        this.drawSpark();
    }

    get rowHeight(): number {
        return ROW_HEIGHT;
    }

    setPending(text = 'waiting'): void {
        this.state = 'pending';
        this.samples = [];
        this.setValue(text);
        this.drawSpark();
    }

    setRunning(): void {
        this.state = 'running';
        this.setValue('running…');
    }

    setFailed(text = 'failed'): void {
        this.state = 'failed';
        this.setValue(text);
    }

    /** Live update while the test runs: a sample for the sparkline plus a label. */
    sample(v: number, text: string): void {
        this.state = 'running';
        this.samples.push(v);
        if (this.samples.length > 24) this.samples.shift();
        this.max = Math.max(0.0001, ...this.samples);
        this.setValue(text);
        this.drawSpark();
    }

    setDone(text: string): void {
        this.state = 'done';
        this.setValue(text);
        this.drawSpark();
    }

    private setValue(text: string): void {
        this.value.text = text;
        this.value.tint = this.state === 'failed' ? Colors.pink : this.state === 'done' ? Colors.grayE : Colors.gray9;
    }

    private drawSpark(): void {
        const g = this.spark.clear();
        if (this.samples.length < 2) return;
        const w = 120;
        const h = 26;
        const max = this.max || 1;
        g.moveTo(0, h - (this.samples[0] / max) * h);
        for (let i = 1; i < this.samples.length; i++) {
            g.lineTo((i / (this.samples.length - 1)) * w, h - (this.samples[i] / max) * h);
        }
        g.stroke({ width: 1.5, color: this.state === 'failed' ? Colors.pink : Colors.pinkLight, alpha: 0.9 });
        // Baseline, so the shape reads as a chart rather than a stray line.
        g.moveTo(0, h).lineTo(w, h).stroke({ width: 1, color: 0xffffff, alpha: 0.12 });
    }

    /** The row's samples (for the CSV-ish copy of the report). */
    get history(): readonly number[] {
        return this.samples;
    }
}

/**
 * Settings → Graphics → Personalize: runs the CPU and GPU benchmarks on
 * this device, shows their numbers live and after the run, and can write
 * the recommended graphics values into the settings.
 */
export class PersonalizeOverlay extends Overlay {
    protected override readonly popInSample = 'UI/dialog-pop-in';
    protected override readonly popOutSample = 'UI/dialog-pop-out';
    override readonly exclusive = false;

    private readonly panel = new Container();
    private readonly card = new Box({ color: colors.background5, radius: 12, border: { width: 1, color: 0x000000, alpha: 0.4 } });
    private readonly header = new Box({ color: Colors.pinkDark, radius: 12, corners: 'top' });
    private readonly title: Text;
    private readonly subtitle: Text;
    private readonly barBg = new Graphics();
    private readonly barFill = new Graphics();
    private readonly status: Text;
    private readonly scroll = new ScrollContainer();
    private readonly footer = new Box({ color: colors.background6, radius: 12, corners: 'bottom' });
    private readonly runButton: Button;
    private readonly applyButton: Button;
    private readonly copyButton: Button;
    private readonly closeButton: Button;
    private readonly rows = new Map<string, BenchRow>();
    private readonly sections: Text[] = [];
    private readonly resultLines: Text[] = [];
    private readonly resultBox = new Container();

    private report: BenchmarkReport | null = null;
    private stored: StoredBenchmark | null = null;
    private running = false;
    private stopRequested = false;
    private fraction = 0;
    private progressLabel = '';
    private dirty = false;
    private viewW = CARD_W;

    constructor(game: Game) {
        super(game);
        this.backdropAlpha = 0.66;
        this.title = label('Personalize graphics', { size: 22, weight: '700' });
        this.subtitle = label('benchmark this device and set everything to fit it', { size: 14, weight: '500', color: Colors.grayE });
        this.status = label('', { size: 12, weight: '600', color: Colors.grayE });
        this.panel.addChild(this.card, this.header, this.title, this.subtitle, this.barBg, this.barFill, this.status,
            this.scroll, this.footer);
        this.panel.eventMode = 'static';
        this.addChild(this.panel);

        this.runButton = new Button('Run benchmark', { color: Colors.pink, height: 38, fontSize: 14 });
        this.runButton.onActivate = () => void this.run();
        this.applyButton = new Button('Apply recommended', { color: Colors.pinkDark, height: 38, fontSize: 14 });
        this.applyButton.onActivate = () => this.apply();
        this.copyButton = new Button('Copy report', { color: colors.background6, height: 38, fontSize: 14 });
        this.copyButton.onActivate = () => void this.copy();
        this.closeButton = new Button('Close', { color: colors.background6, height: 38, fontSize: 14 });
        this.closeButton.onActivate = () => this.hide();
        this.panel.addChild(this.runButton, this.applyButton, this.copyButton, this.closeButton);

        this.buildRows();
        this.restore();
        this.updateButtons();
    }

    // ------------------------------------------------------------------
    // Rows
    // ------------------------------------------------------------------

    private section(title: string): void {
        const t = label(title, { size: 11, weight: '800', color: Colors.pinkLight, letterSpacing: 1.2 });
        this.sections.push(t);
        this.scroll.content.addChild(t);
    }

    private addRow(id: string, title: string, detail: string): void {
        const row = new BenchRow(id, title, detail);
        this.rows.set(id, row);
        this.scroll.content.addChild(row);
    }

    private buildRows(): void {
        this.section('CPU');
        for (const w of CPU_WORKLOADS) this.addRow(w.id, w.name, w.detail);
        this.section('GPU');
        for (const scale of SCENE_SCALES) {
            this.addRow(sceneId(scale), `Playfield at ${Math.round(scale * 100)}%`, 'a busy osu!standard frame, timed to the GPU');
        }
        this.addRow('fill', 'Overdraw / fill rate', `${7} blended full-screen layers`);
        this.addRow('quads', 'Sprite batching', '4000 small sprites in one frame');

        this.section('Result');
        this.scroll.content.addChild(this.resultBox);
    }

    private resultLine(text = '', size = 13, weight: '500' | '600' | '700' = '500', color: number = Colors.grayE): Text {
        const t = label(text, { size, weight, color, wrap: CARD_W - PAD * 2 });
        this.resultLines.push(t);
        this.resultBox.addChild(t);
        return t;
    }

    /** Show the last run from storage (so the numbers are there before running again). */
    private restore(): void {
        this.stored = loadBenchmark();
        if (!this.stored) {
            this.resultLine('No benchmark has run on this device yet.', 13, '600', Colors.gray9);
            this.resultLine('Run it once to measure this CPU and GPU and get values made for them. It takes about three seconds.', 12, '500', Colors.gray9);
            return;
        }
        this.showStored(this.stored);
    }

    private showStored(s: StoredBenchmark): void {
        this.clearResult();
        this.resultLine(`Last run ${formatAge(s.at)}.`, 12, '600', Colors.gray9);
        this.resultLine(`CPU index ${round(s.cpuIndex, 2)} · ${describeTiers(s.tiers)}`, 14, '700');
        if (s.gpuName) this.resultLine(s.gpuName, 11, '500', Colors.gray9);
        for (const [id, rate] of Object.entries(s.cpuRate)) {
            const w = CPU_WORKLOADS.find(x => x.id === id);
            const row = this.rows.get(id);
            row?.setDone(formatRate(rate, w?.unit ?? 'ops'));
        }
        for (const sm of s.sceneMs) {
            this.rows.get(sceneId(sm.scale))?.setDone(`${formatMs(sm.p95)} p95`);
        }
        if (s.fill !== null) this.rows.get('fill')?.setDone(formatRate(s.fill * 1e6, 'pixels/s'));
        if (s.quads !== null) this.rows.get('quads')?.setDone(formatRate(s.quads * 1e3, 'quads/s'));
        this.resultLine('', 6);
        for (const reason of s.reasons) this.resultLine(reason, 12, '500', Colors.gray9);
        this.resultLine('', 6);
        this.resultLine('Recommended', 13, '700', Colors.pinkLight);
        for (const line of describeValues(s.values)) this.resultLine(line, 12);
        this.applyButton.enabled = true;
    }

    private clearResult(): void {
        for (const t of this.resultLines) {
            t.removeFromParent();
            t.destroy();
        }
        this.resultLines.length = 0;
    }

    // ------------------------------------------------------------------
    // Running
    // ------------------------------------------------------------------

    private async run(): Promise<void> {
        if (this.running) return;
        this.running = true;
        this.stopRequested = false;
        this.fraction = 0;
        this.progressLabel = 'starting';
        this.clearResult();
        for (const row of this.rows.values()) row.setPending();
        this.updateButtons();
        const app = this.game.app;
        const started = performance.now();
        // Native pixels (CSS × DPR), not the current canvas size: the
        // recommended render scale has to mean the same thing as the setting.
        const dpr = Math.min(3, Math.max(0.5, window.devicePixelRatio || 1));
        const nativeW = Math.max(320, Math.round(window.innerWidth * dpr));
        const nativeH = Math.max(180, Math.round(window.innerHeight * dpr));
        const adapter = (app.renderer as unknown as { gl?: unknown; device?: { adapter?: unknown } });
        const gpuName = gpuNameOf(adapter.gl ?? adapter.device?.adapter);
        try {
            const report = await runBenchmark({
                renderer: app.renderer,
                hints: deviceHints(),
                gpuName,
                width: nativeW,
                height: nativeH,
                refreshHz: app.loop.stats.refreshHz || 60,
                onProgress: p => this.onProgress(p),
                shouldStop: () => this.stopRequested,
            });
            this.report = report;
            this.stored = benchmarkToStorage(report);
            saveBenchmark(this.stored);
            // The tiers the run measured are what `auto` should use from now on.
            this.game.settings.measured = {
                at: report.at,
                cpuIndex: report.cpuIndex,
                gpuName: report.gpuName,
                fill: report.gpu ? report.gpu.fill.megapixelsPerSecond : null,
                quads: report.gpu ? report.gpu.quads.kiloquadsPerSecond : null,
            };
            this.showReport(report);
            this.status.text = `Finished in ${((performance.now() - started) / 1000).toFixed(1)} s`;
        } catch (e) {
            console.warn('benchmark failed', e);
            this.status.text = 'The benchmark failed; see the console.';
            for (const row of this.rows.values()) if (row.visible) row.setFailed('failed');
        } finally {
            this.running = false;
            this.fraction = 1;
            this.updateButtons();
            this.dirty = true;
        }
    }

    private onProgress(p: BenchmarkProgress): void {
        this.fraction = p.fraction;
        this.progressLabel = p.stage === 'cpu' ? 'CPU' : p.stage === 'gpu' ? 'GPU' : 'finishing';
        const row = this.rows.get(p.label);
        if (row) {
            if (p.stage === 'cpu') {
                row.sample(0, 'running…');
            } else {
                row.setRunning();
            }
        }
        this.status.text = `${this.progressLabel}: ${describeProgress(p.label)} · ${Math.round(p.fraction * 100)}%`;
        this.dirty = true;
    }

    private showReport(r: BenchmarkReport): void {
        this.clearResult();
        this.resultLine(`CPU index ${round(r.cpuIndex, 2)} · ${describeTiers(r.tiers)}`, 14, '700');
        if (r.gpuName) this.resultLine(r.gpuName, 11, '500', Colors.gray9);
        for (const t of r.cpu) {
            this.rows.get(t.id)?.setDone(`${formatRate(t.rate, t.unit)} · ${formatMs(t.timing.median)}/chunk`);
        }
        if (r.gpu) {
            for (const s of r.gpu.scenes) this.rows.get(sceneId(s.scale))?.setDone(`${formatMs(s.timing.p95)} p95`);
            this.rows.get('fill')?.setDone(`${formatRate(r.gpu.fill.megapixelsPerSecond * 1e6, 'pixels/s')} · ${formatMs(r.gpu.fill.timing.median)}`);
            this.rows.get('quads')?.setDone(`${formatRate(r.gpu.quads.kiloquadsPerSecond * 1e3, 'quads/s')} · ${formatMs(r.gpu.quads.timing.median)}`);
        } else {
            this.rows.get(sceneId(SCENE_SCALES[0]))?.setFailed('GPU tests unavailable');
        }
        this.resultLine('', 6);
        for (const reason of r.reasons) this.resultLine(reason, 12, '500', Colors.gray9);
        this.resultLine('', 6);
        this.resultLine('Recommended', 13, '700', Colors.pinkLight);
        for (const line of describeValues(r.values)) this.resultLine(line, 12);
        this.applyButton.enabled = true;
        this.layoutContent();
    }

    /** Write the recommended values into the settings. */
    private apply(): void {
        const values = this.report?.values ?? this.stored?.values;
        if (!values) return;
        const s = this.game.settings;
        applyValues(s, values);
        s.refreshDeviceInfo();
        this.game.notifications.success('Graphics settings set to this device\'s benchmark.');
        this.status.text = 'Applied. The values are in Settings → Graphics to tweak.';
    }

    private async copy(): Promise<void> {
        const text = this.reportText();
        try {
            await navigator.clipboard.writeText(text);
            this.game.notifications.success('Benchmark report copied to the clipboard.');
        } catch {
            console.log(text);
            this.game.notifications.warning('Could not copy; the report is in the console.');
        }
    }

    /** The plain-text report (also what Copy puts on the clipboard). */
    reportText(): string {
        const r = this.report;
        const s = this.stored;
        const lines: string[] = [];
        lines.push('wosu! graphics benchmark');
        const at = r?.at ?? s?.at;
        if (at) lines.push(new Date(at).toLocaleString());
        const tiers = r?.tiers ?? s?.tiers ?? null;
        if (tiers) lines.push(describeTiers(tiers));
        const gpuName = r?.gpuName ?? s?.gpuName;
        if (gpuName) lines.push(`GPU: ${gpuName}`);
        if (r) {
            lines.push(`CPU index: ${round(r.cpuIndex, 2)}`);
            for (const t of r.cpu) {
                lines.push(`  ${t.name}: ${formatRate(t.rate, t.unit)}, chunk median ${formatMs(t.timing.median)}, p95 ${formatMs(t.timing.p95)}`);
            }
            if (r.gpu) {
                for (const sc of r.gpu.scenes) {
                    lines.push(`  Playfield ${Math.round(sc.scale * 100)}% (${sc.width}x${sc.height}): median ${formatMs(sc.timing.median)}, p95 ${formatMs(sc.timing.p95)}`);
                }
                lines.push(`  Fill rate: ${formatRate(r.gpu.fill.megapixelsPerSecond * 1e6, 'pixels/s')}`);
                lines.push(`  Batching: ${formatRate(r.gpu.quads.kiloquadsPerSecond * 1e3, 'quads/s')}`);
                lines.push(`  Quads: ${r.gpu.quads.quads}`);
            }
            lines.push(`Display: ${Math.round(r.refreshHz)} Hz, canvas ${r.width}x${r.height}`);
            for (const reason of r.reasons) lines.push(reason);
            lines.push('Recommended:');
            for (const line of describeValues(r.values)) lines.push(`  ${line}`);
            const samples = [...this.rows.values()].map(row => `${row.id}: ${row.history.map(v => round(v, 2)).join(', ')}`);
            if (samples.length) lines.push('Samples:', ...samples);
        } else if (s) {
            for (const [id, rate] of Object.entries(s.cpuRate)) lines.push(`  ${id}: ${rate}/s`);
            for (const sm of s.sceneMs) lines.push(`  Playfield ${Math.round(sm.scale * 100)}%: p95 ${formatMs(sm.p95)}`);
            for (const reason of s.reasons) lines.push(reason);
            lines.push('Recommended:');
            for (const line of describeValues(s.values)) lines.push(`  ${line}`);
        }
        return lines.join('\n');
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------

    private layoutContent(): void {
        const innerW = this.viewW - PAD * 2;
        let y = 4;
        let rowIndex = 0;
        for (const child of this.scroll.content.children) {
            if (child === this.resultBox) {
                y += 6;
                let ry = 0;
                for (const line of this.resultLines) {
                    line.position.set(PAD, ry);
                    if (!line.text) {
                        ry += 8;
                        continue;
                    }
                    // Wrapped labels report their measured height.
                    const h = Math.max(16, line.height + 4);
                    ry += h;
                }
                this.resultBox.position.set(0, y);
                const boxH = Math.max(ry, 20);
                y += boxH;
                continue;
            }
            if ((child as BenchRow).id === undefined && this.sections.includes(child as Text)) {
                (child as Text).position.set(PAD, y);
                y += 24;
                continue;
            }
            if (child instanceof BenchRow) {
                child.position.set(PAD, y);
                child.resize(innerW, child.rowHeight);
                y += child.rowHeight + 6;
                rowIndex++;
                continue;
            }
        }
        this.scroll.contentHeight = y + 8;
        // A new run starts at the top; a restored report starts at its summary.
        if (!this.running && rowIndex > 0) this.scroll.scrollTo(this.scroll.contentHeight);
    }

    protected override popIn(): void {
        this.relayout();
        this.panel.alpha = 0;
        this.panel.y += 24;
        tween(this.panel, { alpha: 1, y: this.panel.y - 24 }, { duration: 320, ease: 'OutQuint' });
    }

    protected override async popOut(): Promise<void> {
        this.stopRequested = true;
        await tween(this.panel, { alpha: 0 }, { duration: 200 }).finished;
    }

    protected layout(w: number, h: number): void {
        const cardW = Math.min(CARD_W, w - 40);
        const cardH = Math.min(CARD_MAX_H, h - 48);
        this.viewW = cardW;
        this.panel.x = Math.round((w - cardW) / 2);
        this.panel.y = Math.round((h - cardH) / 2);
        this.card.resize(cardW, cardH);
        this.header.resize(cardW, HEADER);
        this.title.position.set(PAD, 22);
        this.subtitle.position.set(PAD, 52);
        this.barBg.clear().roundRect(PAD, HEADER - 14, cardW - PAD * 2, 4, 2).fill({ color: 0x000000, alpha: 0.3 });
        this.status.position.set(PAD, HEADER + 6);
        this.scroll.position.set(0, HEADER + 28);
        this.scroll.resize(cardW, cardH - HEADER - 28 - FOOTER);
        this.footer.position.set(0, cardH - FOOTER);
        this.footer.resize(cardW, FOOTER);
        const bw = Math.min(170, (cardW - PAD * 2 - 30) / 4);
        const by = cardH - FOOTER + 13;
        this.runButton.resize(bw, 38);
        this.runButton.position.set(PAD, by);
        this.applyButton.resize(bw, 38);
        this.applyButton.position.set(PAD + bw + 10, by);
        this.copyButton.resize(bw, 38);
        this.copyButton.position.set(PAD + (bw + 10) * 2, by);
        this.closeButton.resize(bw, 38);
        this.closeButton.position.set(cardW - PAD - bw, by);
        this.layoutContent();
        this.drawBar();
    }

    private drawBar(): void {
        const w = this.viewW - PAD * 2;
        const g = this.barFill.clear();
        if (this.fraction > 0) g.roundRect(PAD, HEADER - 14, Math.max(4, w * Math.min(1, this.fraction)), 4, 2).fill(Colors.pinkLight);
    }

    override update(_dt: number): void {
        if (!this.dirty) return;
        this.dirty = false;
        this.drawBar();
        this.layoutContent();
    }

    private updateButtons(): void {
        this.runButton.enabled = !this.running;
        this.applyButton.enabled = !this.running && !!(this.report || this.stored);
        this.copyButton.enabled = !!(this.report || this.stored);
    }

    override onKey(_e: KeyboardEvent, action: Action | null): boolean {
        if (action === 'back') {
            this.hide();
            return true;
        }
        return false;
    }
}

/** Write a values record into the settings (the same bindables the presets use). */
function applyValues(s: Game['settings'], v: GraphicsValues): void {
    s.resolutionScale.value = v.resolutionScale;
    s.antialias.value = v.antialias;
    s.parallax.value = v.parallax;
    s.backgroundBlur.value = v.backgroundBlur;
    s.backgroundVideo.value = v.backgroundVideo;
    s.storyboard.value = v.storyboard;
    s.hitLighting.value = v.hitLighting;
    s.kiaiFlash.value = v.kiaiFlash;
    s.comboBursts.value = v.comboBursts;
    s.cursorTrail.value = v.cursorTrail;
    s.cursorRipples.value = v.cursorRipples;
    s.hideFollowPoints.value = v.hideFollowPoints;
    s.progressGraph.value = v.progressGraph;
}

/** The recommended values as short human lines, for the panel and the report. */
export function describeValues(v: GraphicsValues): string[] {
    const on = (b: boolean): string => (b ? 'on' : 'off');
    const lines = [
        `Render scale ${Math.round(v.resolutionScale * 100)}% · anti-aliasing ${on(v.antialias)} · background blur ${Math.round(v.backgroundBlur * 100)}%`,
        `Storyboards ${on(v.storyboard)} · background video ${on(v.backgroundVideo)} · hit lighting ${on(v.hitLighting)}`,
        `Combo bursts ${on(v.comboBursts)} · kiai flashes ${on(v.kiaiFlash)} · cursor trail ${on(v.cursorTrail)} · ripples ${on(v.cursorRipples)}`,
        `Follow points ${on(!v.hideFollowPoints)} · progress graph ${on(v.progressGraph)} · parallax ${on(v.parallax)}`,
    ];
    return lines;
}

/** A readable name for a progress id, for the status line. */
function describeProgress(id: string): string {
    for (const w of CPU_WORKLOADS) if (w.id === id) return w.name.toLowerCase();
    for (const scale of SCENE_SCALES) if (sceneId(scale) === id) return `playfield at ${Math.round(scale * 100)}%`;
    if (id === 'fill') return 'overdraw';
    if (id === 'quads') return 'sprite batching';
    return id;
}
