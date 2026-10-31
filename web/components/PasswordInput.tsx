'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Icon } from './Icon';

/**
 * Password field with an eye button to show or hide what was typed.
 * Takes every normal <input> prop except `type`. Hidden again after the form is sent (the parent remounts or clears it).
 */
export function PasswordInput({ className = 'input', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={className}
        // No spellcheck/autocorrect while visible: browsers would otherwise send the text to their dictionaries.
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
      />
      <button
        type="button"
        className="password-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        aria-controls={props.id}
        title={visible ? 'Hide password' : 'Show password'}
        disabled={props.disabled}
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} />
      </button>
    </div>
  );
}
