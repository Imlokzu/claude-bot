import { useState } from "react";
import { HARDWARE, PRICING } from "../config";
import "./pricing.css";

export default function Pricing() {
  const [boardId, setBoardId] = useState("pi4");
  const board = HARDWARE.find((b) => b.id === boardId);

  return (
    <section className="pricing">
      <div className="pricing__head">
        <span className="ov__kicker">
          <span className="chrome__slash">//</span> 04 · Take one home
        </span>
        <h2 className="ov__title ov__title--sm glow-text">SPEC YOUR MACHINE</h2>
      </div>

      {/* ── board picker: the bot's brain ─────────────── */}
      <div className="spec">
        <div className="spec__label">Choose the board</div>
        <div className="spec__boards">
          {HARDWARE.map((b) => (
            <button
              key={b.id}
              className={`board ${b.id === boardId ? "is-active" : ""}`}
              onClick={() => setBoardId(b.id)}
            >
              {b.popular && <span className="board__flag">most picked</span>}
              <span className="board__name">{b.board}</span>
              <span className="board__price">${b.price.toLocaleString()}</span>
              <ul className="board__specs">
                {b.specs.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </button>
          ))}
        </div>
        <p className="spec__note">{board.note}</p>

        <div className="spec__total">
          <div>
            <span className="spec__total-label">Your build</span>
            <span className="spec__total-board">Claude Bot · {board.board}</span>
          </div>
          <div className="spec__total-right">
            <span className="spec__total-price">${board.price.toLocaleString()}</span>
            <button className="hud-btn">Order this build</button>
          </div>
        </div>
      </div>

      {/* ── the two standing offers ───────────────────── */}
      <div className="plans">
        {PRICING.map((p) => (
          <article key={p.id} className={`plan ${p.highlight ? "is-hero" : ""}`}>
            <span className="plan__kicker">{p.kicker}</span>
            <h3 className="plan__title">{p.title}</h3>
            <div className="plan__price">
              {p.price}
              <span className="plan__unit">{p.unit}</span>
            </div>
            <p className="plan__desc">{p.desc}</p>
            <ul className="plan__features">
              {p.features.map((f) => (
                <li key={f}>
                  <span className="dossier__bullet">▸</span>
                  {f}
                </li>
              ))}
            </ul>
            <button className="hud-btn plan__cta">{p.cta}</button>
          </article>
        ))}
      </div>
    </section>
  );
}
