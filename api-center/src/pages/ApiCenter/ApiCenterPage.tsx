import ApiCenterApp from '../../App';

export interface ApiCenterPageProps {
  topOffset: { xs: number; sm: number };
}

export function ApiCenterPage({ topOffset }: ApiCenterPageProps) {
  return <ApiCenterApp topOffset={topOffset} />;
}
