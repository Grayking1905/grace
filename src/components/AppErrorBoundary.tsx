import { Component, type ReactNode } from 'react';
export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: boolean; assetUpdate: boolean }
> {
  state = { error: false, assetUpdate: false };
  static getDerivedStateFromError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: true,
      assetUpdate:
        /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk|ChunkLoadError|Unable to preload CSS/i.test(
          message,
        ),
    };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="fatal">
        <img src="/grace.svg" width="52" alt="Grace" />
        <h1>
          {this.state.assetUpdate ? 'Grace has been updated.' : 'Let’s get you back on track.'}
        </h1>
        <p>
          {this.state.assetUpdate
            ? 'Reload to load the latest version of Grace.'
            : 'Grace hit an unexpected error. Your saved work is safe.'}
        </p>
        <button className="btn primary" onClick={() => window.location.reload()}>
          Reload Grace
        </button>
      </main>
    );
  }
}
