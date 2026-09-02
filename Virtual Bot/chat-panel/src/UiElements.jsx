import React, { useState } from 'react';
import { Button, Checkbox, Input } from 'antd';
import { CheckCircleOutlined, SendOutlined } from '@ant-design/icons';

/**
 * Живі UI-елементи, які малює сам бот через тули ask_question/todo_list/
 * show_choice (див. tools/ui_tools.py). Приходять SSE-подією {type:"ui", ...}
 * і осідають кроком у toolSteps повідомлення (App.jsx), звідки buildBlocks
 * вставляє їх у потрібне місце відповіді.
 *
 * Питання й вибір НЕ чекають відповіді самі — клік просто відправляє текст
 * як звичайне повідомлення користувача (onAnswer = handleSubmit з App.jsx).
 */

export function QuestionCard({ data, onAnswer, disabled }) {
  const [custom, setCustom] = useState('');
  const [answered, setAnswered] = useState('');
  const options = data.options || [];

  const pick = (text) => {
    const clean = (text || '').trim();
    if (!clean || answered || disabled) return;
    setAnswered(clean);
    onAnswer(clean);
  };

  return (
    <div className={`ui-card ui-question${answered ? ' ui-card-answered' : ''}`}>
      <div className="ui-card-title">{data.question}</div>
      {options.length > 0 && (
        <div className="ui-card-options">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              className={`ui-option-btn${answered === opt ? ' ui-option-picked' : ''}`}
              disabled={!!answered || disabled}
              onClick={() => pick(opt)}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      {data.allow_custom !== false && !answered && (
        <div className="ui-card-custom">
          <Input
            size="small"
            placeholder="Своя відповідь…"
            value={custom}
            disabled={disabled}
            onChange={(e) => setCustom(e.target.value)}
            onPressEnter={() => pick(custom)}
          />
          <Button
            size="small"
            type="text"
            icon={<SendOutlined />}
            disabled={disabled || !custom.trim()}
            onClick={() => pick(custom)}
          />
        </div>
      )}
      {answered && (
        <div className="ui-card-answered-note">
          <CheckCircleOutlined /> ви відповіли: «{answered}»
        </div>
      )}
    </div>
  );
}

export function TodoCard({ data }) {
  const [items, setItems] = useState(() => (data.items || []).map((it) => ({ ...it })));
  const toggle = (i) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, done: !it.done } : it)));
  const doneCount = items.filter((it) => it.done).length;

  return (
    <div className="ui-card ui-todo">
      <div className="ui-card-title">
        <span>{data.title || 'Список справ'}</span>
        <span className="ui-todo-progress">
          {doneCount}/{items.length}
        </span>
      </div>
      <ul className="ui-todo-list">
        {items.map((it, i) => (
          <li key={i} className={it.done ? 'ui-todo-item-done' : ''}>
            <Checkbox checked={it.done} onChange={() => toggle(i)}>
              {it.text}
            </Checkbox>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChoiceCards({ data, onAnswer, disabled }) {
  const [answered, setAnswered] = useState('');
  const options = data.options || [];

  const pick = (label) => {
    if (!label || answered || disabled) return;
    setAnswered(label);
    onAnswer(label);
  };

  return (
    <div className={`ui-card ui-choice${answered ? ' ui-card-answered' : ''}`}>
      {data.title && <div className="ui-card-title">{data.title}</div>}
      <div className="ui-choice-grid">
        {options.map((opt) => (
          <button
            key={opt.label}
            type="button"
            className={`ui-choice-card${answered === opt.label ? ' ui-option-picked' : ''}`}
            disabled={!!answered || disabled}
            onClick={() => pick(opt.label)}
          >
            <div className="ui-choice-label">{opt.label}</div>
            {opt.description && <div className="ui-choice-desc">{opt.description}</div>}
          </button>
        ))}
      </div>
      {answered && (
        <div className="ui-card-answered-note">
          <CheckCircleOutlined /> обрано: «{answered}»
        </div>
      )}
    </div>
  );
}

/* Диспетчер за step.kind — саме його рендерить BotAnswer у хронологічній стрічці. */
export default function UiElement({ step, onAnswer, disabled }) {
  const data = step.data || {};
  switch (step.kind) {
    case 'question':
      return <QuestionCard data={data} onAnswer={onAnswer} disabled={disabled} />;
    case 'todo':
      return <TodoCard data={data} />;
    case 'choice':
      return <ChoiceCards data={data} onAnswer={onAnswer} disabled={disabled} />;
    default:
      return null;
  }
}
