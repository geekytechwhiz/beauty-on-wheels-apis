import SwaggerUI from 'swagger-ui-react';

export interface SwaggerPanelProps {
  url?: string;
  spec?: object;
}

export function SwaggerPanel({ url, spec }: SwaggerPanelProps) {
  return (
    <div className="swagger-panel">
      <SwaggerUI spec={spec} url={url} />
    </div>
  );
}
