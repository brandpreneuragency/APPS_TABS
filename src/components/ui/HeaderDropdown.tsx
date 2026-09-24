import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export interface HeaderDropdownOption {
  value: string;
  label: string;
}

interface HeaderDropdownProps {
  value: string;
  options: HeaderDropdownOption[];
  onChange: (value: string) => void;
  align?: 'left' | 'right';
  wrapperClassName?: string;
  menuClassName?: string;
  buttonClassName?: string;
}

function cx(...classes: Array<string | undefined | false>) {
  return classes.filter(Boolean).join(' ');
}

export function HeaderDropdown({
  value,
  options,
  onChange,
  align = 'left',
  wrapperClassName,
  menuClassName,
  buttonClassName,
}: HeaderDropdownProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const selected = useMemo(
    () => options.find((opt) => opt.value === value) ?? options[0],
    [options, value]
  );

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  return (
    <div ref={ref} className={cx('relative header-dropdown-wrap', wrapperClassName)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cx('header-dropdown-button w-full row', buttonClassName)}
        style={{ borderRadius: 'var(--radius-sm)', background: 'transparent' }}
      >
        <span className="trunc med">{selected?.label ?? ''}</span>
        <ChevronDown size={12} className="subtle shrink-0" />
      </button>

      {open && (
        <div
          className={cx(
            'drop header-dropdown-menu',
            align === 'right' ? 'header-dropdown-menu--right' : 'header-dropdown-menu--left',
            menuClassName
          )}
        >
          {options.map((opt) => (
            <button
              key={opt.value || '__empty__'}
              type="button"
              onClick={() => {
                onChange(opt.value);
                setOpen(false);
              }}
              className={cx('drop-item', opt.value === value && 'header-dropdown-item--active')}
            >
              <span className="trunc med">{opt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
