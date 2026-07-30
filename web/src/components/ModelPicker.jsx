import { useEffect, useRef, useState } from 'react';

import { Icon } from './Icons.jsx';

const TIER_LABEL = {
  pro: 'Pro',
  fast: 'Fast',
  lite: 'Lite',
  image: 'Image',
};

export default function ModelPicker({ models, value, onChange, disabled }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDocClick = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const current = models.find((m) => m.id === value);

  return (
    <div className="model-picker" ref={wrapRef}>
      <button
        type="button"
        className="model-trigger"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="model-name">{current?.name || 'Model'}</span>
        <Icon.Chevron width={16} height={16} />
      </button>

      {open && (
        <ul className="model-menu" role="listbox" aria-label="Choose a model">
          {models.map((model) => (
            <li key={model.id}>
              <button
                type="button"
                role="option"
                aria-selected={model.id === value}
                className={`model-option${model.id === value ? ' selected' : ''}`}
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
              >
                <span className={`model-badge tier-${model.tier}`}>
                  {model.image ? <Icon.Image width={14} height={14} /> : TIER_LABEL[model.tier]}
                </span>
                <span className="model-copy">
                  <strong>{model.name}</strong>
                  <small>{model.blurb}</small>
                </span>
                {model.id === value && <Icon.Check width={16} height={16} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
