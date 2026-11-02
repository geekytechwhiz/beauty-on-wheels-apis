import readline from 'node:readline';

/**
 * Hidden terminal OTP prompt. Digits are never echoed. Callers must not log
 * the return value.
 */
export async function promptHiddenOtp(
  label = 'Enter OTP (input hidden): ',
): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // Mute echo for the secret entry.
  const mutable = rl as readline.Interface & {
    _writeToOutput?: (str: string) => void;
    output?: NodeJS.WritableStream;
  };
  mutable._writeToOutput = (str: string) => {
    if (str.includes('\n') || str.includes('\r')) {
      mutable.output?.write('\n');
    }
  };

  try {
    const answer = await new Promise<string>((resolve) => {
      rl.question(label, (value) => resolve(value));
    });
    return answer.trim();
  } finally {
    rl.close();
  }
}
