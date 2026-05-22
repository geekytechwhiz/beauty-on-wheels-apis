export class PaginationService {

    paginate(data: any[], query: any) {
  
      const count = parseInt(query._count ?? 20);
      const page = parseInt(query.page ?? 1);
  
      const start = (page - 1) * count;
      const end = start + count;
  
      return {
        results: data.slice(start, end),
        total: data.length
      };
  
    }
  
  }