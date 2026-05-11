// import {
//     LambdaClient,
//     ListFunctionsCommand,
//     ListVersionsByFunctionCommand,
//     DeleteFunctionCommand,
//     ListAliasesCommand,
//   } from "@aws-sdk/client-lambda";
  
   
  const LambdaClientInstance = require("@aws-sdk/client-lambda");
  const { LambdaClient, ListFunctionsCommand, ListVersionsByFunctionCommand, DeleteFunctionCommand, ListAliasesCommand } = LambdaClientInstance;
  const client = new LambdaClient({ region: "us-east-1" });
  
  const KEEP_LAST_N = 2;
  
  async function cleanup() {
    const functions = await client.send(new ListFunctionsCommand({}));
  
    for (const fn of functions.Functions || []) {
      const functionName = fn?.FunctionName;
      // console.log(`\nProcessing: ${functionName}`);
  
      // Get aliases
      const aliasesRes = await client.send(
        new ListAliasesCommand({ FunctionName: functionName })
      );
      const protectedVersions = new Set(
        (aliasesRes.Aliases || []).map(a => a.FunctionVersion)
      );
  
      // Get versions
      const versionsRes = await client.send(
        new ListVersionsByFunctionCommand({ FunctionName: functionName })
      );
  
      const versions = (versionsRes.Versions || [])
        .map(v => v.Version)
        .filter(v => v !== "$LATEST")
        .sort((a, b) => Number(b) - Number(a));
  
      const versionsToDelete = versions.slice(KEEP_LAST_N);
  
      for (const version of versionsToDelete) {
        if (protectedVersions.has(version)) {
          // console.log(`Skipping alias version: ${version}`);
          continue;
        }
  
        try {
          await client.send(
            new DeleteFunctionCommand({
              FunctionName: functionName,
              Qualifier: version,
            })
          );
          // console.log(`Deleted version: ${version}`);
        } catch (err) {
          // console.log(`Error deleting ${version}:`, err.message);
        }
      }
    }
  }
  
  cleanup();