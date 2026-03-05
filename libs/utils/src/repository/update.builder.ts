export const buildUpdateExpression = (updates: Record<string, any>) => {

    const updateParts: string[] = [];
    const names: Record<string,string> = {};
    const values: Record<string,any> = {};
  
    Object.entries(updates).forEach(([key,value]) => {
  
      const name = `#${key}`;
      const val = `:${key}`;
  
      updateParts.push(`${name} = ${val}`);
      names[name] = key;
      values[val] = value;
  
    });
  
    return {
      UpdateExpression: `SET ${updateParts.join(", ")}`,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values
    };
  };