import readline from "node:readline";
import { stdin as input, stdout as output } from "node:process";

export class ConsoleApprovals {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    this.rl = null;
  }

  async confirm(message) {
    if (!this.enabled) return true;
    if (!input.isTTY) return false;

    if (!this.rl) {
      this.rl = readline.createInterface({ input, output });
    }

    const answer = await question(this.rl, `${message}\nApprove? [y/N] `);
    return ["y", "yes"].includes(answer.trim().toLowerCase());
  }

  close() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

function question(rl, prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}
