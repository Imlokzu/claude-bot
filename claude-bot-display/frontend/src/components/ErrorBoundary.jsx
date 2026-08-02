import { Component } from "react";

const RESET_DELAY_MS = 5000;

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.resetTimer = null;
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("Screen error:", error, info);
    if (this.resetTimer) clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      this.setState({ hasError: false });
    }, RESET_DELAY_MS);
  }

  componentWillUnmount() {
    if (this.resetTimer) clearTimeout(this.resetTimer);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="screen-content"
          style={{ justifyContent: "center", alignItems: "center", textAlign: "center" }}
        >
          <div style={{ fontSize: 40, marginBottom: 8 }}>×_×</div>
          <div className="card-title">Помилка екрана</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Перезапуск за кілька секунд...
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
