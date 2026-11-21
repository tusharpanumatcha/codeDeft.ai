import React from 'react';

type Props = { name: string; children: React.ReactNode };
type State = { error: Error | null };

/** Contains a render crash to one panel; the rest of the dashboard keeps working. */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: Error, info: React.ErrorInfo) { console.error(`codeDeft ${this.props.name} panel crashed`, error, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="panel alert" role="alert">
        <h3>The {this.props.name} panel hit an unexpected error</h3>
        <p className="muted">{this.state.error.message}</p>
        <button type="button" onClick={() => this.setState({ error: null })}>Reload this panel</button>
      </section>
    );
  }
}
