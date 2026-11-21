import React from 'react';

/** Page title (focus target when navigating, so screen readers announce the new page) and one-line purpose. */
export function PageHeader({ title, children, actions }: { title: string; children?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="page-header">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1 tabIndex={-1}>{title}</h1>
        {actions}
      </div>
      {children && <p>{children}</p>}
    </div>
  );
}
