import { RedocStandalone } from 'redoc';

export interface RedocPanelProps {
  spec: object;
}

export function RedocPanel({ spec }: RedocPanelProps) {
  return <RedocStandalone spec={spec} />;
}
