type CliOptions = {
    project: string;
    tsconfig?: string;
    dryRun?: boolean;
    verbose?: boolean;
  };
  
  export function parseCliArgs(): CliOptions {
    const args = process.argv.slice(2);
  
    const options: CliOptions = {
      project: "",
    };
  
    args.forEach((arg) => {
      const [key, value] = arg.split("=");
  
      switch (key) {
        case "--project":
          options.project = value;
          break;
        case "--tsconfig":
          options.tsconfig = value;
          break;
        case "--dry-run":
          options.dryRun = true;
          break;
        case "--verbose":
          options.verbose = true;
          break;
      }
    });
  
    if (!options.project) {
      throw new Error("❌ --project is required");
    }
  
    return options;
  }