const formatDate = (date: Date): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}/${month}/${day}`;
  };
  
  const getDateWithOffset = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return formatDate(date);
  };
  
  const fromDateString = (days: number) => getDateWithOffset(-days);
  const todayString = () => getDateWithOffset(0);
  const toDateString = (days: number) => getDateWithOffset(days);
  
  export { formatDate, todayString, toDateString, fromDateString };