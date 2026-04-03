import SwaggerUI from 'swagger-ui-react';

export interface SwaggerPanelProps {
  spec: object;
}

export function SwaggerPanel({ spec }: SwaggerPanelProps) {
  return (
    <div className="swagger-panel">
      <SwaggerUI spec={spec} />
    </div>
  );
}
