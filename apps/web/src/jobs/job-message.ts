/**
 * A job's status message as My jobs shows it (#23): without the exception
 * code a server may put in front of its own words, such as
 * `InvalidParameterValue: ` or `NoApplicableCode: `. The code says nothing to
 * a visitor; the words after it do. Only for showing: the observation and the
 * job's record keep the message whole.
 *
 * A code is one word of two or more capitalised parts, then a colon and a
 * space, at the very start. `Error: …` or `Note: …` is left as it is, and so
 * is a message that would be nothing without the code.
 */
export function withoutExceptionCode(message: string): string {
  const rest = message.replace(/^(?:[A-Z][a-z0-9]+){2,}:\s+/, "");
  return rest.trim() === "" ? message : rest;
}
