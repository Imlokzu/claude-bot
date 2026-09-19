"use client";

import type { ReactNode } from "react";
import styles from "./DataTable.module.css";

/*
 * Джерело: https://www.aicss.dev/r/data-table.json (реєстр shadcn).
 *
 * Змінено: в оригіналі це демо з трьома зашитими рядками про моделі OpenAI /
 * Anthropic / Meta і трьома логотипами брендів. Тут компонент приймає
 * заголовки й рядки, бо малює він таблиці з відповідей бота, а які вони
 * будуть — наперед невідомо. Логотипи прибрані: у чужій таблиці вони
 * підписували б дані брендом, якого в даних немає.
 *
 * Розкладка, розміри й CSS-модуль — як в оригіналі.
 */

export interface DataTableProps {
  /* ReactNode, а не string: у таблицю з відповіді бота цілком може прийти
     посилання або жирний текст, і зводити комірку до голого рядка означало б
     мовчки їх викинути. */
  columns: ReactNode[];
  rows: ReactNode[][];
  /** Вирівнювання по колонках; типово — по лівому краю. */
  align?: ("left" | "right" | "center")[];
  className?: string;
}

export function DataTable({ columns, rows, align, className }: DataTableProps) {
  // Комірка — flex-контейнер (так у їхньому CSS), тож вирівнювання тут
  // робиться розкладкою, а не text-align: text-align на flex не діє.
  const JUSTIFY = { left: "flex-start", center: "center", right: "flex-end" } as const;
  const at = (i: number) => JUSTIFY[align?.[i] ?? "left"];
  return (
    <div className={styles.tbl + (className ? " " + className : "")}>
      <div className={styles.tblHead}>
        {columns.map((head, i) => (
          <div key={i} className={styles.tblCell} style={{ justifyContent: at(i) }}>
            {head}
          </div>
        ))}
      </div>
      <div className={styles.tblBody}>
        {rows.map((row, r) => (
          <div key={r} className={styles.tblRow}>
            {columns.map((_, c) => (
              <div key={c} className={styles.tblCell} style={{ justifyContent: at(c) }}>
                <span className={styles.tblCellText}>{row[c] ?? null}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
