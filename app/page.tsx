'use client';
import { useEffect, useRef, useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { RotateCcw, ArrowUpRight } from 'lucide-react';
import type { JellyWorld } from '@/lib/jelly';

export default function Home() {
  const host = useRef<HTMLDivElement>(null);
  const world = useRef<JellyWorld | null>(null);
  const [color, setColor] = useState('berry');
  const [firmness, setFirmness] = useState(38);
  const [damping, setDamping] = useState(28);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    let disposed = false;
    import('@/lib/jelly')
      .then(async ({ JellyWorld }) => {
        if (disposed || !host.current) return;
        const engine = new JellyWorld(host.current);
        world.current = engine;
        await engine.init();
        if (disposed) engine.dispose();
        else setReady(true);
      })
      .catch((e) => {
        console.error(e);
        if (!disposed) setError(true);
      });
    return () => {
      disposed = true;
      world.current?.dispose();
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    type ToolContext = {
      registerTool(
        tool: {
          name: string;
          title: string;
          description: string;
          inputSchema: object;
          annotations: object;
          execute(input: unknown): Promise<object>;
        },
        options: { signal: AbortSignal },
      ): void | Promise<void>;
    };
    const context = (document as Document & { modelContext?: ToolContext })
      .modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tool = {
      name: 'configure_jelly',
      title: 'Configure jelly',
      description:
        'Set the jelly color, firmness and internal damping, or reset its shape. Updates the visible controls.',
      inputSchema: {
        type: 'object',
        properties: {
          color: { type: 'string', enum: ['berry', 'mint', 'honey'] },
          firmness: { type: 'number', minimum: 0, maximum: 100 },
          damping: { type: 'number', minimum: 0, maximum: 100 },
          reset: { type: 'boolean' },
        },
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      async execute(input: unknown) {
        if (!input || typeof input !== 'object' || Array.isArray(input))
          throw new Error('Expected a settings object.');
        const data = input as Record<string, unknown>;
        if (
          Object.keys(data).some(
            (k) => !['color', 'firmness', 'damping', 'reset'].includes(k),
          )
        )
          throw new Error('Unknown setting.');
        if (
          data.color !== undefined &&
          !['berry', 'mint', 'honey'].includes(data.color as string)
        )
          throw new Error('Choose berry, mint or honey.');
        for (const key of ['firmness', 'damping'])
          if (
            data[key] !== undefined &&
            (typeof data[key] !== 'number' ||
              !Number.isFinite(data[key]) ||
              (data[key] as number) < 0 ||
              (data[key] as number) > 100)
          )
            throw new Error('Settings must be numbers from 0 to 100.');
        if (data.reset !== undefined && typeof data.reset !== 'boolean')
          throw new Error('Reset must be a boolean.');
        if (data.color !== undefined) {
          setColor(data.color as string);
          world.current?.setColor(data.color as string);
        }
        if (data.firmness !== undefined) {
          setFirmness(data.firmness as number);
          world.current?.setFirmness(data.firmness as number);
        }
        if (data.damping !== undefined) {
          setDamping(data.damping as number);
          world.current?.setDamping(data.damping as number);
        }
        if (data.reset) world.current?.reset();
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
        return { updated: true, ...data };
      },
    };
    try {
      void Promise.resolve(
        context.registerTool(tool, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {
      /* Optional browser API. */
    }
    return () => lifecycle.abort();
  }, [ready]);
  const reset = () => {
    world.current?.reset();
  };
  return (
    <main className="laboratory">
      <div
        ref={host}
        className="scene"
        aria-label="Interactive 3D jelly. Drag any point on its surface to stretch it."
      />
      <header className="masthead">
        <p className="eyebrow">
          MATERIAL STUDIES <span>/</span> NO. 001
        </p>
        <h1>
          Soft
          <br />
          <em>Matter.</em>
        </h1>
        <p className="intro">
          A little gravity.
          <br />A little light.
          <br />A very soft solid.
        </p>
      </header>
      <div className="live">
        <i /> INTERACTIVE EXPERIMENT
      </div>
      {!ready && (
        <div className="loading" role="status">
          {error
            ? 'Unable to start the 3D scene. Please reload in a browser with graphics enabled.'
            : 'Setting the jelly…'}
        </div>
      )}
      <aside className="controls" aria-label="Jelly controls">
        <div className="panel-head">
          <h2>THE SPECIMEN</h2>
          <span>01 — GEL</span>
        </div>
        <div className="swatches" aria-label="Color">
          {[
            ['berry', 'Berry', '粉红'],
            ['mint', 'Mint', '薄荷绿'],
            ['honey', 'Honey', '蜂蜜色'],
          ].map(([id, label, zh]) => (
            <button
              key={id}
              aria-label={zh}
              aria-pressed={color === id}
              className={`swatch ${id} ${color === id ? 'selected' : ''}`}
              onClick={() => {
                setColor(id);
                world.current?.setColor(id);
              }}
            >
              <i />
              {label}
            </button>
          ))}
        </div>
        <div className="setting">
          <div className="setting-label">
            <label id="firmness-label">Firmness</label>
            <output>
              {(0.4 + firmness * 0.025).toFixed(2)} <small>kPa</small>
            </output>
          </div>
          <Slider
            aria-labelledby="firmness-label"
            min={0}
            max={100}
            value={[firmness]}
            onValueChange={(v) => {
              const n = Array.isArray(v) ? v[0] : v;
              setFirmness(n);
              world.current?.setFirmness(n);
            }}
          />
          <div className="range-ends">
            <span>Soft</span>
            <span>Firm</span>
          </div>
        </div>
        <div className="setting">
          <div className="setting-label">
            <label id="damping-label">Internal damping</label>
            <output>
              {(0.5 + damping * 0.055).toFixed(1)} <small>s⁻¹</small>
            </output>
          </div>
          <Slider
            aria-labelledby="damping-label"
            min={0}
            max={100}
            value={[damping]}
            onValueChange={(v) => {
              const n = Array.isArray(v) ? v[0] : v;
              setDamping(n);
              world.current?.setDamping(n);
            }}
          />
          <div className="range-ends">
            <span>Wobbly</span>
            <span>Calm</span>
          </div>
        </div>
        <button className="reset" onClick={reset}>
          <RotateCcw size={14} strokeWidth={1.5} /> Reset specimen{' '}
          <span>R</span>
        </button>
        <p className="panel-note">
          A small study in softness.
          <ArrowUpRight size={12} />
        </p>
      </aside>
      <footer className="footnote">
        <p>Take hold. Let go.</p>
        <span>Drag the jelly. Feel the inertia.</span>
        <div className="spec">
          <div>
            124.8 <small>g</small>
            <label>MASS</label>
          </div>
          <div>
            98.6 <small>%</small>
            <label>REST VOLUME</label>
          </div>
          <div>
            01<label>SPECIMEN</label>
          </div>
        </div>
      </footer>
      <div className="colophon">A LITTLE PLAY, A LITTLE PHYSICS.</div>
    </main>
  );
}
