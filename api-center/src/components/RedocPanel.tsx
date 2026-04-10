import { RedocStandalone } from 'redoc';

export interface RedocPanelProps {
  specUrl?: string;
  spec?: object;
}

export function RedocPanel({ specUrl, spec }: RedocPanelProps) {
  return <RedocStandalone spec={spec} specUrl={specUrl} />;
}
