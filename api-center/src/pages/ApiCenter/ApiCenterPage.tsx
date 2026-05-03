import ApiCenterApp from '../../App';

export function ApiCenterPage({ topOffset }: ApiCenterPageProps) {
  return <ApiCenterApp topOffset={topOffset} />;
}

export interface ApiCenterPageProps {
  topOffset: { xs: number; sm: number };
}
