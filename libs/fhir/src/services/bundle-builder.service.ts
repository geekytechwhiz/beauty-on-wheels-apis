export class BundleBuilder {

    buildSearchBundle(resources: any[], total: number, baseUrl: string) {
  
      return {
        resourceType: "Bundle",
        type: "searchset",
        total,
        entry: resources.map(r => ({
          resource: r
        })),
        link: [
          {
            relation: "self",
            url: baseUrl
          }
        ]
      };
  
    }
  
  }