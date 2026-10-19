// StyleControls — the left-hand side of the Style tab.
//
// Renders grouped controls for every field that actually exists on
// LeadFormStyleConfig (see src/types/forms.ts). Each control writes via
// the `updateStyle` helper, which calls
// `formsStore.updateForm(form.id, { style: {...form.style, [field]: value} })`.
// There is no dedicated updateStyle action.

import { useCallback } from 'react';
import type { ChangeEvent } from 'react';
import type { LeadForm, LeadFormStyleConfig } from '../../../../types/forms';
import { useFormsStore } from '../../../../stores/formsStore';

// NonNullable unions for select casting.
type ButtonStyle = NonNullable<LeadFormStyleConfig['buttonStyle']>;
type InputStyle = NonNullable<LeadFormStyleConfig['inputStyle']>;
type Layout = NonNullable<LeadFormStyleConfig['layout']>;
type BorderStyle = NonNullable<LeadFormStyleConfig['borderStyle']>;

// Number-valued style keys (for the shared numeric handler).
type NumberKey =
  | 'fontSize'
  | 'padding'
  | 'borderRadius'
  | 'headingFontSize'
  | 'fieldSpacing'
  | 'borderWidth';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
function isValidHex(v: string | undefined): v is string {
  return typeof v === 'string' && HEX_RE.test(v);
}

export interface StyleControlsProps {
  form: LeadForm;
}

export function StyleControls({ form }: StyleControlsProps) {
  const updateForm = useFormsStore((s) => s.updateForm);
  const s = form.style;

  // Type-safe single-field style updater.
  const updateStyle = useCallback(
    <K extends keyof LeadFormStyleConfig>(key: K, value: LeadFormStyleConfig[K]) => {
      updateForm(form.id, { style: { ...form.style, [key]: value } });
    },
    [form.id, form.style, updateForm],
  );

  const onNumber = (key: NumberKey) => (e: ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    if (raw === '') {
      updateStyle(key, undefined);
      return;
    }
    const n = Number(raw);
    if (Number.isFinite(n)) updateStyle(key, n);
  };

  const onButtonStyle = (e: ChangeEvent<HTMLSelectElement>) =>
    updateStyle('buttonStyle', e.target.value as ButtonStyle);
  const onInputStyle = (e: ChangeEvent<HTMLSelectElement>) =>
    updateStyle('inputStyle', e.target.value as InputStyle);
  const onLayout = (e: ChangeEvent<HTMLSelectElement>) =>
    updateStyle('layout', e.target.value as Layout);
  const onBorderStyle = (e: ChangeEvent<HTMLSelectElement>) =>
    updateStyle('borderStyle', e.target.value as BorderStyle);

  return (
    <div className="ui-panel-body forms-builder-style-controls-inner">
      {/* ---------- Colors ---------- */}
      <section className="ui-card forms-builder-style-group">
        <h4 className="forms-builder-style-group-title">Colors</h4>
        <ColorField label="Primary" value={s.primaryColor} onChange={(v) => updateStyle('primaryColor', v)} />
        <ColorField label="Background" value={s.backgroundColor} onChange={(v) => updateStyle('backgroundColor', v)} />
        <ColorField label="Text" value={s.textColor} onChange={(v) => updateStyle('textColor', v)} />
        <ColorField label="Label" value={s.labelColor} onChange={(v) => updateStyle('labelColor', v)} />
        <ColorField label="Border" value={s.borderColor} onChange={(v) => updateStyle('borderColor', v)} />
      </section>

      {/* ---------- Typography ---------- */}
      <section className="ui-card forms-builder-style-group">
        <h4 className="forms-builder-style-group-title">Typography</h4>
        <div className="ui-field forms-builder-style-row">
          <label className="forms-builder-style-label" htmlFor="tabs-style-fontFamily">Font family</label>
          <input
            id="tabs-style-fontFamily"
            className="ui-input forms-builder-style-input"
            type="text"
            value={s.fontFamily ?? ''}
            placeholder="Inter, system-ui, sans-serif"
            onChange={(e) => updateStyle('fontFamily', e.target.value)}
          />
        </div>
        <div className="ui-field forms-builder-style-row">
          <label className="forms-builder-style-label" htmlFor="tabs-style-fontSize">Base font size (px)</label>
          <input
            id="tabs-style-fontSize"
            className="ui-input forms-builder-style-input"
            type="number"
            min={8}
            max={32}
            value={s.fontSize ?? ''}
            onChange={onNumber('fontSize')}
          />
        </div>
        <ColorField
          label="Heading"
          value={s.headingColor}
          onChange={(v) => updateStyle('headingColor', v)}
        />
        <div className="ui-field forms-builder-style-row">
          <label className="forms-builder-style-label" htmlFor="tabs-style-headingFontSize">
            Heading font size (px)
          </label>
          <input
            id="tabs-style-headingFontSize"
            className="ui-input forms-builder-style-input"
            type="number"
            min={8}
            max={48}
            value={s.headingFontSize ?? ''}
            onChange={onNumber('headingFontSize')}
          />
        </div>
      </section>

      {/* ---------- Spacing & radius ---------- */}
      <section className="ui-card forms-builder-style-group">
        <h4 className="forms-builder-style-group-title">Spacing &amp; radius</h4>
        <div className="ui-field forms-builder-style-row">
          <label className="forms-builder-style-label" htmlFor="tabs-style-padding">Padding (px)</label>
          <input
            id="tabs-style-padding"
            className="ui-input forms-builder-style-input"
            type="number"
            min={0}
            max={64}
            value={s.padding ?? ''}
            onChange={onNumber('padding')}
          />
        </div>
        <div className="ui-field forms-builder-style-row">
          <label className="forms-builder-style-label" htmlFor="tabs-style-borderRadius">Corner radius (px)</label>
          <input
            id="tabs-style-borderRadius"
            className="ui-input forms-builder-style-input"
            type="number"
            min={0}
            max={32}
            value={s.borderRadius ?? ''}
            onChange={onNumber('borderRadius')}
          />
        </div>
      </section>

      {/* ---------- Components ---------- */}
      <section className="ui-card forms-builder-style-group">
        <h4 className="forms-builder-style-group-title">Components</h4>
        <div className="ui-field forms-builder-style-row">
          <label className="forms-builder-style-label" htmlFor="tabs-style-buttonStyle">Button style</label>
          <select
            id="tabs-style-buttonStyle"
            className="ui-input forms-builder-style-select"
            value={s.buttonStyle ?? 'solid'}
            onChange={onButtonStyle}
          >
            <option value="solid">Solid</option>
            <option value="outline">Outline</option>
            <option value="ghost">Ghost</option>
          </select>
        </div>
        <div className="ui-field forms-builder-style-row">
          <label className="forms-builder-style-label" htmlFor="tabs-style-inputStyle">Input style</label>
          <select
            id="tabs-style-inputStyle"
            className="ui-input forms-builder-style-select"
            value={s.inputStyle ?? 'boxed'}
            onChange={onInputStyle}
          >
            <option value="boxed">Boxed</option>
            <option value="underline">Underline</option>
            <option value="minimal">Minimal</option>
          </select>
        </div>
        <div className="ui-field forms-builder-style-row">
          <label className="forms-builder-style-label" htmlFor="tabs-style-layout">Layout</label>
          <select
            id="tabs-style-layout"
            className="ui-input forms-builder-style-select"
            value={s.layout ?? 'single'}
            onChange={onLayout}
          >
            <option value="single">Single column</option>
            <option value="two_column">Two column</option>
          </select>
        </div>
      </section>

      {/* ---------- Fields ---------- */}
      <section className="ui-card forms-builder-style-group">
        <h4 className="forms-builder-style-group-title">Fields</h4>
        <ColorField
          label="Field background"
          value={s.fieldBackgroundColor}
          onChange={(v) => updateStyle('fieldBackgroundColor', v)}
        />
        <ColorField
          label="Field border"
          value={s.fieldBorderColor}
          onChange={(v) => updateStyle('fieldBorderColor', v)}
        />
        <ColorField
          label="Field focus border"
          value={s.fieldFocusBorderColor}
          onChange={(v) => updateStyle('fieldFocusBorderColor', v)}
        />
        <ColorField
          label="Field text"
          value={s.fieldTextColor}
          onChange={(v) => updateStyle('fieldTextColor', v)}
        />
        <div className="ui-field forms-builder-style-row">
          <label className="forms-builder-style-label" htmlFor="tabs-style-fieldSpacing">
            Field spacing (px)
          </label>
          <input
            id="tabs-style-fieldSpacing"
            className="ui-input forms-builder-style-input"
            type="number"
            min={0}
            max={64}
            value={s.fieldSpacing ?? ''}
            onChange={onNumber('fieldSpacing')}
          />
        </div>
      </section>

      {/* ---------- Borders ---------- */}
      <section className="ui-card forms-builder-style-group">
        <h4 className="forms-builder-style-group-title">Borders</h4>
        <div className="ui-field forms-builder-style-row">
          <label className="forms-builder-style-label" htmlFor="tabs-style-borderWidth">
            Border width (px)
          </label>
          <input
            id="tabs-style-borderWidth"
            className="ui-input forms-builder-style-input"
            type="number"
            min={0}
            max={16}
            value={s.borderWidth ?? ''}
            onChange={onNumber('borderWidth')}
          />
        </div>
        <div className="ui-field forms-builder-style-row">
          <label className="forms-builder-style-label" htmlFor="tabs-style-borderStyle">
            Border style
          </label>
          <select
            id="tabs-style-borderStyle"
            className="ui-input forms-builder-style-select"
            value={s.borderStyle ?? 'solid'}
            onChange={onBorderStyle}
          >
            <option value="solid">Solid</option>
            <option value="dashed">Dashed</option>
            <option value="dotted">Dotted</option>
            <option value="none">None</option>
          </select>
        </div>
      </section>

      {/* ---------- Buttons ---------- */}
      <section className="ui-card forms-builder-style-group">
        <h4 className="forms-builder-style-group-title">Buttons</h4>
        <ColorField
          label="Button background"
          value={s.buttonBackgroundColor}
          onChange={(v) => updateStyle('buttonBackgroundColor', v)}
        />
        <ColorField
          label="Button hover background"
          value={s.buttonHoverBackgroundColor}
          onChange={(v) => updateStyle('buttonHoverBackgroundColor', v)}
        />
        <ColorField
          label="Button text"
          value={s.buttonTextColor}
          onChange={(v) => updateStyle('buttonTextColor', v)}
        />
      </section>

      {/* ---------- Messages ---------- */}
      <section className="ui-card forms-builder-style-group">
        <h4 className="forms-builder-style-group-title">Messages</h4>
        <ColorField
          label="Success text"
          value={s.successColor}
          onChange={(v) => updateStyle('successColor', v)}
        />
        <ColorField
          label="Success background"
          value={s.successBackgroundColor}
          onChange={(v) => updateStyle('successBackgroundColor', v)}
        />
        <ColorField
          label="Error text"
          value={s.errorColor}
          onChange={(v) => updateStyle('errorColor', v)}
        />
        <ColorField
          label="Error background"
          value={s.errorBackgroundColor}
          onChange={(v) => updateStyle('errorBackgroundColor', v)}
        />
      </section>

      {/* ---------- Custom CSS ---------- */}
      <section className="ui-card forms-builder-style-group">
        <h4 className="forms-builder-style-group-title">Custom CSS</h4>
        <p className="forms-builder-style-hint">
          Applied only to the published / preview form output, not the builder UI.
        </p>
        <textarea
          className="ui-input forms-builder-style-textarea"
          value={s.customCss ?? ''}
          placeholder={'.forms-embed-root {\n  /* overrides */\n}'}
          spellCheck={false}
          onChange={(e) => updateStyle('customCss', e.target.value)}
          aria-label="Custom CSS for the embedded form"
        />
      </section>
    </div>
  );
}

// ---- ColorField: native swatch + hex text, both bound to one field ----
interface ColorFieldProps {
  label: string;
  value: string | undefined;
  onChange: (v: string) => void;
}

function ColorField({ label, value, onChange }: ColorFieldProps) {
  const swatch = isValidHex(value) ? value : '#000000';
  const fieldId = `tabs-style-color-${label.replace(/\s+/g, '-').toLowerCase()}`;
  return (
    <div className="ui-field forms-builder-style-row">
      <label className="forms-builder-style-label" htmlFor={`${fieldId}-hex`}>
        {label}
      </label>
      <div className="forms-builder-style-color-controls">
        <input
          id={`${fieldId}-swatch`}
          className="forms-builder-color-input"
          type="color"
          value={swatch}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} color`}
        />
        <input
          id={`${fieldId}-hex`}
          className="ui-input forms-builder-style-input forms-builder-style-input--hex"
          type="text"
          value={value ?? ''}
          placeholder="#000000"
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} hex value`}
        />
      </div>
    </div>
  );
}
