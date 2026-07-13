// Minimal ambient declaration for the workerd built-in used by the Email
// Sending binding. It has no npm types; only the shape we call is declared.
declare module "cloudflare:email" {
  export class EmailMessage {
    constructor(from: string, to: string, raw: string | ReadableStream);
  }
}
