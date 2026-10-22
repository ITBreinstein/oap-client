/**
 * STYLE TRIAL (updated Instrument, #13): what is wrong with the JSON in a
 * box, said right under it in plain words. The parser's own words are for
 * developers: shown with `?developer`.
 */

import { useDeveloper } from "./developer.js";
import { plainJsonMessage, type JsonTrouble } from "../forms/json-trouble.js";

export function JsonTroubleNote({
  id,
  trouble,
}: {
  /** The field's error id, which its controls are described by. */
  readonly id: string;
  readonly trouble: JsonTrouble;
}) {
  const developer = useDeveloper();
  return (
    <p id={id} className="field-error json-trouble">
      {plainJsonMessage(trouble)}
      {developer && <span className="json-trouble-detail"> The parser says: {trouble.detail}</span>}
    </p>
  );
}
