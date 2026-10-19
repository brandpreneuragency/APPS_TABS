import type { LeadForm, LeadFormEmbedConfig } from '../../../../types/forms';
import { useFormsStore } from '../../../../stores/formsStore';

interface UtmCaptureConfigProps {
  form: LeadForm;
}

/**
 * UTM/source fields captured on form submission and merged into the
 * submission's `hiddenFields`. The 10 canonical capture fields match
 * the CRMUtmData shape plus landing/page/device/submitted_at metadata.
 *
 * Storage note: LeadFormEmbedConfig does not declare a `utmCapture` key,
 * so the enabled set is stored on `form.embed` under a `utmCapture` key
 * via a typed cast (extra embed metadata). Default = all 10 enabled.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const UTM_CAPTURE_FIELDS: readonly string[] = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referrer',
  'landing_page',
  'page_url',
  'device_type',
  'submitted_at',
] as const;

type EmbedWithUtm = LeadFormEmbedConfig & { utmCapture?: string[] };

function readUtmCapture(form: LeadForm): string[] {
  const embed = form.embed as EmbedWithUtm;
  if (Array.isArray(embed.utmCapture)) {
    return embed.utmCapture.filter((f) => UTM_CAPTURE_FIELDS.includes(f));
  }
  // Default: all enabled.
  return [...UTM_CAPTURE_FIELDS];
}

export function UtmCaptureConfig({ form }: UtmCaptureConfigProps) {
  const updateForm = useFormsStore((s) => s.updateForm);
  const enabled = readUtmCapture(form);

  const toggle = (field: string) => {
    const next = enabled.includes(field)
      ? enabled.filter((f) => f !== field)
      : [...enabled, field];
    void updateForm(form.id, {
      embed: { ...form.embed, utmCapture: next } as LeadFormEmbedConfig,
    });
  };

  const setAll = (on: boolean) => {
    const next = on ? [...UTM_CAPTURE_FIELDS] : [];
    void updateForm(form.id, {
      embed: { ...form.embed, utmCapture: next } as LeadFormEmbedConfig,
    });
  };

  const allOn = enabled.length === UTM_CAPTURE_FIELDS.length;
  const noneOn = enabled.length === 0;

  return (
    <div className="ui-card forms-builder-logic-section">
      <div className="forms-builder-logic-utm-head">
        <div className="forms-builder-logic-section-head">
          <span className="forms-builder-logic-section-title">UTM &amp; Source Capture</span>
          <span className="forms-builder-logic-section-count">{enabled.length} / {UTM_CAPTURE_FIELDS.length}</span>
        </div>
        <div className="forms-builder-logic-utm-bulk">
          <button
            type="button"
            className="ui-button forms-builder-logic-utm-bulk-btn"
            onClick={() => setAll(true)}
            disabled={allOn}
          >
            All
          </button>
          <button
            type="button"
            className="ui-button forms-builder-logic-utm-bulk-btn"
            onClick={() => setAll(false)}
            disabled={noneOn}
          >
            None
          </button>
        </div>
      </div>
      <p className="forms-builder-logic-section-hint">
        Selected fields are captured from the visitor's browser/referrer on submit
        and merged into the submission's hidden fields.
      </p>
      <div className="forms-builder-utm-grid">
        {UTM_CAPTURE_FIELDS.map((field) => {
          const isChecked = enabled.includes(field);
          return (
            <label key={field} className="forms-builder-utm-item">
              <input
                type="checkbox"
                className="forms-builder-logic-utm-checkbox"
                checked={isChecked}
                onChange={() => toggle(field)}
              />
              <span className="forms-builder-utm-item-name">{field}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

export default UtmCaptureConfig;
