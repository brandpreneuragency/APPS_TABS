// FormRenderer — the embeddable lead form.
//
// Renders a LeadForm schema into a real, submittable form. Handles all 13
// field types, conditional logic, validation, multi-step, honeypot spam
// protection, UTM capture, file-upload-disabled notices, and submission via
// `submissionService.ingestSubmission`. Styling is fully isolated via CSS
// custom properties set from `form.style` (see embed.css) — it does NOT depend
// on the host app's design tokens, so a published form looks the same wherever
// it is embedded.

import { useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, CSSProperties, FormEvent, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, AlertCircle, Lock } from 'lucide-react';
import type { LeadForm, LeadFormField, LeadFormLogicRule, LeadFormEmbedConfig } from '../../../types/forms';
import type { CRMUtmData } from '../../../types/crm';
import { ingestSubmission } from '../../../services/submissionService';
import type { IngestionResult } from '../../../services/submissionService';
import { isDomainAllowed } from '../../../services/embedService';
import { HoneypotField } from './HoneypotField';
import { EmbedSuccessMessage } from './EmbedSuccessMessage';
import { collectUtmAndSourceData, pickEnabledUtm, DEFAULT_ENABLED_UTM } from './UtmCapture';
import './embed.css';

export interface FormRendererProps {
  form: LeadForm;
  /** Called after a successful (non-honeypot) ingestion. */
  onSubmitSuccess?: (result: IngestionResult) => void;
  /**
   * True when rendering inside a published embed (iframe/script/web component).
   * Gate that makes `disabledInPublishedEmbed` file fields render disabled.
   */
  isPublishedEmbed?: boolean;
  /** UTM keys to capture. Defaults to all (see DEFAULT_ENABLED_UTM). */
  enabledUtmFields?: ReadonlySet<string>;
}

// CRM_FORMS_RATE_LIMIT_TODO:
// enforce server-side rate limits in future backend; client-side throttle placeholder here
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 3;
const submissionLog = new Map<string, number[]>();

function isRateLimited(formId: string): boolean {
  const now = Date.now();
  const recent = (submissionLog.get(formId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  return recent.length >= RATE_LIMIT_MAX;
}

function recordSubmission(formId: string): void {
  const now = Date.now();
  const recent = (submissionLog.get(formId) ?? []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  submissionLog.set(formId, recent);
}

// ---------------------------------------------------------------------------
// Logic rule evaluation (pure)
// ---------------------------------------------------------------------------

function toNum(v: unknown): number | null {
  if (v === '' || v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function isEmptyValue(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

function evaluateRule(
  rule: LeadFormLogicRule,
  fields: LeadFormField[],
  values: Record<string, unknown>,
): boolean {
  const trigger = fields.find((f) => f.id === rule.triggerFieldId);
  if (!trigger) return false;
  const current = values[trigger.name];
  const target = rule.value;
  switch (rule.operator) {
    case 'eq':
      return target === undefined ? false : String(current ?? '') === String(target);
    case 'neq':
      return target === undefined ? true : String(current ?? '') !== String(target);
    case 'contains':
      return current != null && String(current).includes(String(target ?? ''));
    case 'gt': {
      const n = toNum(current);
      const t = toNum(target);
      return n !== null && t !== null && n > t;
    }
    case 'lt': {
      const n = toNum(current);
      const t = toNum(target);
      return n !== null && t !== null && n < t;
    }
    case 'gte': {
      const n = toNum(current);
      const t = toNum(target);
      return n !== null && t !== null && n >= t;
    }
    case 'lte': {
      const n = toNum(current);
      const t = toNum(target);
      return n !== null && t !== null && n <= t;
    }
    case 'is_empty':
      return isEmptyValue(current);
    case 'is_not_empty':
      return !isEmptyValue(current);
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Validation (pure)
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateField(field: LeadFormField, value: unknown): string | null {
  const v = field.validation;
  const required = field.required === true || v?.required === true;
  const empty = isEmptyValue(value);

  if (required && empty) {
    return v?.message ?? `${field.label} is required.`;
  }
  if (empty) return null;

  if (field.type === 'email' && typeof value === 'string' && !EMAIL_PATTERN.test(value)) {
    return v?.message ?? 'Please enter a valid email address.';
  }

  if (v) {
    if (v.minLength != null && typeof value === 'string' && value.length < v.minLength) {
      return v.message ?? `Must be at least ${v.minLength} characters.`;
    }
    if (v.maxLength != null && typeof value === 'string' && value.length > v.maxLength) {
      return v.message ?? `Must be at most ${v.maxLength} characters.`;
    }
    if (v.min != null) {
      const n = toNum(value);
      if (n !== null && n < v.min) return v.message ?? `Must be ${v.min} or greater.`;
    }
    if (v.max != null) {
      const n = toNum(value);
      if (n !== null && n > v.max) return v.message ?? `Must be ${v.max} or less.`;
    }
    if (v.pattern != null && typeof value === 'string') {
      try {
        const re = new RegExp(v.pattern);
        if (!re.test(value)) return v.message ?? 'Invalid format.';
      } catch {
        // Bad pattern in config — ignore rather than block the user.
      }
    }
  }
  return null;
}

function defaultFieldValue(field: LeadFormField): unknown {
  switch (field.type) {
    case 'checkbox':
      return field.options && field.options.length > 0 ? [] : false;
    case 'consent':
      return false;
    case 'number':
      return '';
    default:
      return '';
  }
}

function fieldId(field: LeadFormField): string {
  return `tabs-form-field-${field.id}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FormRenderer({
  form,
  onSubmitSuccess,
  isPublishedEmbed = false,
  enabledUtmFields,
}: FormRendererProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [honeypot, setHoneypot] = useState<string>('');
  const [stepIndex, setStepIndex] = useState<number>(0);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitted, setSubmitted] = useState<boolean>(false);

  // Reset internal state when the form identity changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues({});
    setErrors({});
    setGlobalError(null);
    setHoneypot('');
    setStepIndex(0);
    setSubmitted(false);
  }, [form.id]);

  // ----- conditional logic: field visibility -------------------------------
  const hiddenFieldIds = useMemo(() => {
    const hidden = new Set<string>();
    for (const rule of form.logicRules) {
      if (!rule.enabled) continue;
      if (rule.type !== 'show_field' && rule.type !== 'hide_field') continue;
      const matches = evaluateRule(rule, form.fields, values);
      for (const targetId of rule.targetFieldIds ?? []) {
        if (rule.type === 'show_field') {
          // show_field = "only show when matches"; hide when it doesn't.
          if (!matches) hidden.add(targetId);
        } else {
          if (matches) hidden.add(targetId);
        }
      }
    }
    return hidden;
  }, [form.logicRules, form.fields, values]);

  // ----- conditional logic: step visibility --------------------------------
  const visibleStepIds = useMemo(() => {
    const visible = new Set(form.steps.map((s) => s.id));
    for (const rule of form.logicRules) {
      if (!rule.enabled) continue;
      if (rule.type !== 'show_step' && rule.type !== 'hide_step') continue;
      if (!rule.targetStepId) continue;
      const matches = evaluateRule(rule, form.fields, values);
      if (rule.type === 'show_step') {
        if (!matches) visible.delete(rule.targetStepId);
      } else {
        if (matches) visible.delete(rule.targetStepId);
      }
    }
    return visible;
  }, [form.steps, form.logicRules, form.fields, values]);

  // ----- conditional logic: block_submit -----------------------------------
  const blockMessage = useMemo(() => {
    for (const rule of form.logicRules) {
      if (!rule.enabled || rule.type !== 'block_submit') continue;
      if (evaluateRule(rule, form.fields, values)) {
        return rule.message ?? 'Submission is not available with the current selection.';
      }
    }
    return null;
  }, [form.logicRules, form.fields, values]);

  // ----- conditional logic: set_value (apply as effect to avoid loops) -----
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const rule of form.logicRules) {
        if (!rule.enabled || rule.type !== 'set_value') continue;
        if (!evaluateRule(rule, form.fields, prev)) continue;
        const targetId = rule.targetFieldIds?.[0];
        if (!targetId || rule.value === undefined) continue;
        const target = form.fields.find((f) => f.id === targetId);
        if (!target) continue;
        if (next[target.name] !== rule.value) {
          next[target.name] = rule.value;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [form.logicRules, form.fields, values]);

  // ----- derived step / field lists ----------------------------------------
  const isMultiStep = form.steps.length > 1;
  const orderedSteps = useMemo(
    () => [...form.steps].sort((a, b) => a.order - b.order),
    [form.steps],
  );
  const visibleSteps = useMemo(
    () => (isMultiStep ? orderedSteps.filter((s) => visibleStepIds.has(s.id)) : orderedSteps),
    [isMultiStep, orderedSteps, visibleStepIds],
  );
  const currentStep = isMultiStep ? visibleSteps[stepIndex] : null;

  const visibleFields = useMemo(() => {
    const sorted = [...form.fields].sort((a, b) => a.order - b.order);
    return sorted.filter((f) => {
      if (hiddenFieldIds.has(f.id)) return false;
      if (f.type === 'submit' || f.type === 'hidden') return false;
      if (!isMultiStep) return true;
      if (f.stepId) return f.stepId === currentStep?.id;
      // Fields without an explicit stepId live on the first visible step.
      return stepIndex === 0;
    });
  }, [form.fields, hiddenFieldIds, isMultiStep, currentStep, stepIndex]);

  const submitField = useMemo(
    () => form.fields.find((f) => f.type === 'submit'),
    [form.fields],
  );
  const submitLabel = submitField?.label ?? 'Submit';

  // ----- style isolation: build CSS custom properties from form.style ------
  // Existing fields are always set with `??` fallbacks so a form renders even
  // before any style is applied. New (extended) fields are only mapped when
  // explicitly set, so the embed.css defaults on `.forms-embed-root` apply
  // otherwise — keeping forms styled only with the old fields visually identical.
  const cssVars = useMemo<Record<string, string>>(() => {
    const s = form.style;
    const vars: Record<string, string> = {
      '--tabs-form-primary': s.primaryColor ?? '#4f46e5',
      '--tabs-form-bg': s.backgroundColor ?? '#ffffff',
      '--tabs-form-text': s.textColor ?? '#111827',
      '--tabs-form-label': s.labelColor ?? '#374151',
      '--tabs-form-border': s.borderColor ?? '#d1d5db',
      '--tabs-form-radius': (s.borderRadius ?? 8) > 29 ? 'var(--radius-full)' : 'var(--radius-sm)',
      '--tabs-form-font-family': s.fontFamily ?? 'Inter, system-ui, sans-serif',
      '--tabs-form-font-size': `${s.fontSize ?? 14}px`,
      '--tabs-form-padding': `${s.padding ?? 20}px`,
      '--tabs-form-field-bg': s.backgroundColor ?? '#ffffff',
      '--tabs-form-button-style': s.buttonStyle ?? 'solid',
      '--tabs-form-input-style': s.inputStyle ?? 'boxed',
      '--tabs-form-layout': s.layout ?? 'single',
    };

    // --- Extended style fields (only override when configured) ---
    // Typography
    if (s.headingColor !== undefined) vars['--tabs-form-heading-color'] = s.headingColor;
    if (s.headingFontSize !== undefined) vars['--tabs-form-heading-size'] = `${s.headingFontSize}px`;
    // Fields
    if (s.fieldBackgroundColor !== undefined) {
      // Overrides the field-bg mapping above cleanly (more specific than page bg).
      vars['--tabs-form-field-bg'] = s.fieldBackgroundColor;
    }
    if (s.fieldBorderColor !== undefined) vars['--tabs-form-field-border'] = s.fieldBorderColor;
    if (s.fieldFocusBorderColor !== undefined) {
      vars['--tabs-form-field-focus-border'] = s.fieldFocusBorderColor;
    }
    if (s.fieldTextColor !== undefined) vars['--tabs-form-field-text'] = s.fieldTextColor;
    if (s.fieldSpacing !== undefined) vars['--tabs-form-field-spacing'] = `${s.fieldSpacing}px`;
    // Borders
    if (s.borderWidth !== undefined) vars['--tabs-form-border-width'] = `${s.borderWidth}px`;
    if (s.borderStyle !== undefined) vars['--tabs-form-border-style'] = s.borderStyle;
    // Buttons
    if (s.buttonBackgroundColor !== undefined) vars['--tabs-form-button-bg'] = s.buttonBackgroundColor;
    if (s.buttonHoverBackgroundColor !== undefined) {
      vars['--tabs-form-button-hover-bg'] = s.buttonHoverBackgroundColor;
    }
    if (s.buttonTextColor !== undefined) vars['--tabs-form-button-text'] = s.buttonTextColor;
    // Messages
    if (s.successColor !== undefined) vars['--tabs-form-success'] = s.successColor;
    if (s.successBackgroundColor !== undefined) vars['--tabs-form-success-bg'] = s.successBackgroundColor;
    if (s.errorColor !== undefined) vars['--tabs-form-error'] = s.errorColor;
    if (s.errorBackgroundColor !== undefined) vars['--tabs-form-error-bg'] = s.errorBackgroundColor;

    return vars;
  }, [form.style]);

  const rootStyle = cssVars as unknown as CSSProperties;
  const layoutClass =
    form.style.layout === 'two_column'
      ? 'forms-embed-layout-two_column'
      : 'forms-embed-layout-single';
  const buttonClass = `forms-embed-btn forms-embed-btn--${form.style.buttonStyle ?? 'solid'}`;
  const inputBaseClass = `forms-embed-input forms-embed-input--${form.style.inputStyle ?? 'boxed'}`;

  // ----- value accessors ---------------------------------------------------
  const getValue = (field: LeadFormField): unknown => {
    const v = values[field.name];
    return v === undefined ? defaultFieldValue(field) : v;
  };

  const setValue = (name: string, value: unknown): void => {
    setValues((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  };

  const handleChange = (field: LeadFormField, raw: unknown): void => {
    setValue(field.name, raw);
  };

  // ----- step navigation ---------------------------------------------------
  const validateStep = (fields: LeadFormField[]): boolean => {
    const nextErrors: Record<string, string> = {};
    for (const field of fields) {
      const err = validateField(field, getValue(field));
      if (err) nextErrors[field.name] = err;
    }
    setErrors((prev) => ({ ...prev, ...nextErrors }));
    return Object.keys(nextErrors).length === 0;
  };

  const handleNext = (): void => {
    if (!validateStep(visibleFields)) return;
    setStepIndex((i) => Math.min(i + 1, visibleSteps.length - 1));
  };

  const handleBack = (): void => {
    setStepIndex((i) => Math.max(i - 1, 0));
  };

  // ----- submit ------------------------------------------------------------
  const resetForm = (): void => {
    setValues({});
    setErrors({});
    setGlobalError(null);
    setHoneypot('');
    setStepIndex(0);
    setSubmitted(false);
  };

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setGlobalError(null);

    if (blockMessage) {
      setGlobalError(blockMessage);
      return;
    }

    // Validate every visible, non-hidden, non-submit field across all steps.
    const newErrors: Record<string, string> = {};
    const fieldsToValidate = form.fields.filter(
      (f) =>
        !hiddenFieldIds.has(f.id) && f.type !== 'submit' && f.type !== 'hidden',
    );
    for (const field of fieldsToValidate) {
      const err = validateField(field, getValue(field));
      if (err) newErrors[field.name] = err;
    }
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      // Jump to the first step that contains an error so the user sees it.
      if (isMultiStep) {
        const firstName = Object.keys(newErrors)[0];
        const failingField = form.fields.find((f) => f.name === firstName);
        if (failingField?.stepId) {
          const idx = visibleSteps.findIndex((s) => s.id === failingField.stepId);
          if (idx >= 0) setStepIndex(idx);
        }
      }
      return;
    }
    setErrors({});

    if (isRateLimited(form.id)) {
      setGlobalError('Too many submissions. Please wait a moment and try again.');
      return;
    }

    setSubmitting(true);
    try {
      const utmAll = collectUtmAndSourceData();
      const formUtmCapture = (form.embed as LeadFormEmbedConfig & { utmCapture?: string[] }).utmCapture;
      const enabledSet = enabledUtmFields ?? (Array.isArray(formUtmCapture) ? new Set(formUtmCapture) : DEFAULT_ENABLED_UTM);
      const hiddenFields = pickEnabledUtm(utmAll, enabledSet) as CRMUtmData & Record<string, unknown>;

      const sourceDomain =
        typeof window !== 'undefined' && typeof window.location.hostname === 'string'
          ? window.location.hostname
          : undefined;
      const allowedDomainMatched = isDomainAllowed(form.embed, sourceDomain);

      const honeypotFilled = honeypot.trim() !== '';

      // CRM_FORMS_PUBLIC_CAPTURE_TODO:
      // The embed snippets are generated now, but production lead capture requires
      // a public VPS/API endpoint. Future backend agent must implement public form
      // rendering, allowed-domain validation, CORS policy, rate limiting, spam checks,
      // submission persistence, duplicate matching, and CRM lead creation.
      const result = await ingestSubmission({
        formId: form.id,
        fields: values,
        hiddenFields,
        sourceDomain,
        allowedDomainMatched,
        honeypot: honeypot || undefined,
        spamScore: honeypotFilled ? 95 : undefined,
      });
      recordSubmission(form.id);

      // CRM_FORMS_WEBHOOK_DELIVERY_TODO:
      // Webhook settings are stored now, but delivery/retry/logging is deferred.
      // Future backend agent must implement signed payloads, timeout handling,
      // retry policy, webhook logs, failure states, and test-send action.

      // Honeypot-triggered spam: show a fake success so bots don't learn they
      // were caught, and skip the host callback so spam doesn't spawn tasks.
      if (honeypotFilled) {
        setSubmitted(true);
        return;
      }

      setSubmitted(true);
      onSubmitSuccess?.(result);
    } catch (err) {
      setGlobalError(
        err instanceof Error ? err.message : 'Submission failed. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ----- success state -----------------------------------------------------
  if (submitted) {
    return (
      <div className={`forms-embed-root ${layoutClass}`} style={rootStyle}>
        {form.style.customCss ? (
          <style dangerouslySetInnerHTML={{ __html: form.style.customCss }} />
        ) : null}
        <EmbedSuccessMessage message={form.successMessage} onReset={resetForm} />
      </div>
    );
  }

  // ----- field renderers ---------------------------------------------------
  const renderLabel = (field: LeadFormField): ReactNode => {
    if (field.type === 'hidden' || field.type === 'submit') return null;
    return (
      <label htmlFor={fieldId(field)} className="forms-embed-label">
        {field.label}
        {field.required && <span className="forms-embed-required" aria-hidden="true"> *</span>}
      </label>
    );
  };

  const renderHelpText = (field: LeadFormField): ReactNode =>
    field.helpText ? <p className="forms-embed-help">{field.helpText}</p> : null;

  const renderError = (field: LeadFormField): ReactNode => {
    const msg = errors[field.name];
    return msg ? (
      <p className="forms-embed-error" id={`${fieldId(field)}-error`} role="alert">
        <AlertCircle size={12} strokeWidth={2} />
        <span>{msg}</span>
      </p>
    ) : null;
  };

  const renderFieldInput = (field: LeadFormField): ReactNode => {
    const value = getValue(field);
    const ariaInvalid = errors[field.name] ? true : undefined;
    const errDescribedBy = errors[field.name] ? `${fieldId(field)}-error` : undefined;
    const commonProps = {
      id: fieldId(field),
      name: field.name,
      'aria-invalid': ariaInvalid,
      'aria-describedby': errDescribedBy,
      disabled: submitting,
    };

    switch (field.type) {
      case 'text':
        return (
          <input
            {...commonProps}
            type="text"
            className={inputBaseClass}
            placeholder={field.placeholder}
            value={(value as string) ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              handleChange(field, e.target.value)
            }
          />
        );

      case 'email':
        return (
          <input
            {...commonProps}
            type="email"
            className={inputBaseClass}
            placeholder={field.placeholder}
            value={(value as string) ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              handleChange(field, e.target.value)
            }
          />
        );

      case 'phone':
        return (
          <input
            {...commonProps}
            type="tel"
            className={inputBaseClass}
            placeholder={field.placeholder}
            value={(value as string) ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              handleChange(field, e.target.value)
            }
          />
        );

      case 'number':
        return (
          <input
            {...commonProps}
            type="number"
            className={inputBaseClass}
            placeholder={field.placeholder}
            value={value === '' ? '' : (value as number)}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              handleChange(field, e.target.value === '' ? '' : Number(e.target.value))
            }
          />
        );

      case 'date':
        return (
          <input
            {...commonProps}
            type="date"
            className={inputBaseClass}
            value={(value as string) ?? ''}
            onChange={(e: ChangeEvent<HTMLInputElement>) =>
              handleChange(field, e.target.value)
            }
          />
        );

      case 'textarea':
        return (
          <textarea
            {...commonProps}
            className={`${inputBaseClass} forms-embed-textarea`}
            placeholder={field.placeholder}
            rows={4}
            value={(value as string) ?? ''}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) =>
              handleChange(field, e.target.value)
            }
          />
        );

      case 'select':
        return (
          <select
            {...commonProps}
            className={inputBaseClass}
            value={(value as string) ?? ''}
            onChange={(e: ChangeEvent<HTMLSelectElement>) =>
              handleChange(field, e.target.value)
            }
          >
            <option value="" disabled={field.required}>
              {field.placeholder ?? 'Select an option…'}
            </option>
            {(field.options ?? []).map((opt) => (
              <option key={opt.id} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        );

      case 'radio':
        return (
          <div className="forms-embed-option-group" role="radiogroup" aria-labelledby={fieldId(field)}>
            {(field.options ?? []).map((opt) => {
              const optId = `${fieldId(field)}-${opt.id}`;
              const checked = value === opt.value;
              return (
                <label key={opt.id} htmlFor={optId} className="forms-embed-option">
                  <input
                    id={optId}
                    type="radio"
                    name={field.name}
                    value={opt.value}
                    checked={checked}
                    disabled={submitting}
                    onChange={() => handleChange(field, opt.value)}
                  />
                  <span className="forms-embed-option-label">{opt.label}</span>
                </label>
              );
            })}
          </div>
        );

      case 'checkbox': {
        // With options → multi-select group. Without options → single boolean.
        if (field.options && field.options.length > 0) {
          const selected = Array.isArray(value) ? (value as string[]) : [];
          return (
            <div className="forms-embed-option-group" role="group" aria-labelledby={fieldId(field)}>
              {field.options.map((opt) => {
                const optId = `${fieldId(field)}-${opt.id}`;
                const checked = selected.includes(opt.value);
                return (
                  <label key={opt.id} htmlFor={optId} className="forms-embed-option">
                    <input
                      id={optId}
                      type="checkbox"
                      name={field.name}
                      value={opt.value}
                      checked={checked}
                      disabled={submitting}
                      onChange={(e: ChangeEvent<HTMLInputElement>) => {
                        const next = e.target.checked
                          ? [...selected, opt.value]
                          : selected.filter((v) => v !== opt.value);
                        handleChange(field, next);
                      }}
                    />
                    <span className="forms-embed-option-label">{opt.label}</span>
                  </label>
                );
              })}
            </div>
          );
        }
        return (
          <label htmlFor={fieldId(field)} className="forms-embed-option forms-embed-option--single">
            <input
              id={fieldId(field)}
              type="checkbox"
              name={field.name}
              checked={value === true}
              disabled={submitting}
              onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange(field, e.target.checked)}
            />
            <span className="forms-embed-option-label">{field.label}</span>
          </label>
        );
      }

      case 'consent':
        return (
          <label htmlFor={fieldId(field)} className="forms-embed-consent">
            <input
              id={fieldId(field)}
              type="checkbox"
              name={field.name}
              checked={value === true}
              disabled={submitting}
              required={field.required}
              onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange(field, e.target.checked)}
            />
            <span className="forms-embed-consent-label">{field.label}</span>
          </label>
        );

      // CRM_FORMS_FILE_UPLOAD_TODO:
      // File upload field UI/config is intentionally included,
      // but live upload storage is not implemented yet.
      // Future VPS agent must connect this to object storage or server storage,
      // signed upload URLs, MIME/type validation, file size limits,
      // virus/security checks, and submission attachment linking
      // before enabling production file uploads.
      case 'file': {
        const disabledForPublish =
          isPublishedEmbed === true && field.disabledInPublishedEmbed === true;
        return (
          <div className="forms-embed-file-wrap">
            <input
              {...commonProps}
              type="file"
              className={inputBaseClass}
              disabled={disabledForPublish || submitting}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                handleChange(field, e.target.files ? Array.from(e.target.files).map((f) => f.name) : [])
              }
            />
            {disabledForPublish && (
              <p className="forms-embed-file-notice">
                <Lock size={12} strokeWidth={2} />
                <span>File upload is disabled until storage is connected.</span>
              </p>
            )}
          </div>
        );
      }

      case 'hidden':
        return (
          <input
            type="hidden"
            name={field.name}
            value={(value as string) ?? ''}
            readOnly
          />
        );

      case 'submit':
        return null; // rendered separately at the bottom.

      default:
        return null;
    }
  };

  const renderField = (field: LeadFormField): ReactNode => {
    if (field.type === 'hidden') {
      return renderFieldInput(field);
    }
    const isInlineCheck =
      field.type === 'consent' || (field.type === 'checkbox' && !(field.options && field.options.length > 0));
    return (
      <div className="forms-embed-field" key={field.id}>
        {!isInlineCheck && renderLabel(field)}
        {renderFieldInput(field)}
        {renderHelpText(field)}
        {renderError(field)}
      </div>
    );
  };

  // ----- step progress (multi-step) ---------------------------------------
  const renderStepHeader = (): ReactNode => {
    if (!isMultiStep || !currentStep) return null;
    const humanIndex = stepIndex + 1;
    const total = visibleSteps.length;
    return (
      <div className="forms-embed-step-header">
        <div className="forms-embed-step-progress" aria-hidden="true">
          {visibleSteps.map((s, i) => (
            <span
              key={s.id}
              className={`forms-embed-step-dot ${i === stepIndex ? 'is-current' : ''} ${i < stepIndex ? 'is-done' : ''}`}
            />
          ))}
        </div>
        <p className="forms-embed-step-title">
          {currentStep.title}
          <span className="forms-embed-step-count"> · Step {humanIndex} of {total}</span>
        </p>
        {currentStep.description && (
          <p className="forms-embed-step-desc">{currentStep.description}</p>
        )}
      </div>
    );
  };

  const isLastStep = !isMultiStep || stepIndex >= visibleSteps.length - 1;

  return (
    <div className={`forms-embed-root ${layoutClass}`} style={rootStyle}>
      {form.style.customCss ? (
        <style dangerouslySetInnerHTML={{ __html: form.style.customCss }} />
      ) : null}

      <form className="forms-embed-form" onSubmit={handleSubmit} noValidate>
        {renderStepHeader()}

        <div className="forms-embed-fields">
          {visibleFields.map(renderField)}
        </div>

        <HoneypotField value={honeypot} onChange={setHoneypot} />

        {globalError && (
          <div className="forms-embed-global-error" role="alert">
            <AlertCircle size={14} strokeWidth={2} />
            <span>{globalError}</span>
          </div>
        )}

        <div className="forms-embed-actions">
          {isMultiStep && stepIndex > 0 && (
            <button
              type="button"
              className="forms-embed-btn forms-embed-btn--ghost"
              onClick={handleBack}
              disabled={submitting}
            >
              <ChevronLeft size={14} strokeWidth={2} />
              <span>Back</span>
            </button>
          )}

          {isMultiStep && !isLastStep && (
            <button
              type="button"
              className={buttonClass}
              onClick={handleNext}
              disabled={submitting}
            >
              <span>Next</span>
              <ChevronRight size={14} strokeWidth={2} />
            </button>
          )}

          {(!isMultiStep || isLastStep) && (
            <button
              type="submit"
              className={buttonClass}
              disabled={submitting}
            >
              {submitting ? 'Submitting…' : submitLabel}
            </button>
          )}
        </div>

        {form.embed.showBranding && (
          <p className="forms-embed-branding">
            Powered by <strong>TABS</strong>
          </p>
        )}
      </form>
    </div>
  );
}
