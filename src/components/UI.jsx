import { useEffect } from'react';
import { Icon } from'./Icon';

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const h = (e) => e.key ==='Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-back" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function Toast({ msg }) {
  if (!msg) return null;
  return <div className="toast">{msg}</div>;
}

export function EmptyState({ icon, title, children }) {
  return (
    <div className="card empty">
      {icon && (
        <div className="big-ico" style={{ display:'flex', justifyContent:'center', marginBottom: 8 }}>
          {typeof icon ==='string' ? <Icon name={icon} size={40} strokeWidth={1.5} color="var(--ink-soft)" /> : icon}
        </div>
      )}
      {title && <p style={{ margin: 0, fontWeight: 600 }}>{title}</p>}
      {children}
    </div>
  );
}
