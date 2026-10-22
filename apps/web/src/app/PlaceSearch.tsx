/**
 * "Find a place" over the map (#16): suggestions from PDOK's Locatieserver as
 * the visitor types, and the map moves to the one chosen. A combobox: the
 * arrow keys move through the list, Enter chooses, Escape closes it. Nothing
 * is sent until something is typed, and then only after a pause: one
 * request per pause, the one before it cancelled.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  createPlaceSearch,
  type Place,
  type PlaceSearch as Search,
  type PlaceSuggestion,
} from "../places/locatieserver.js";

/** How long typing must pause before PDOK is asked. */
export const SUGGEST_AFTER_MS = 250;

export function PlaceSearch({
  onPlace,
  search: given,
}: {
  readonly onPlace: (place: Place) => void;
  /** For a test; PDOK's Locatieserver otherwise. */
  readonly search?: Search | undefined;
}) {
  const base = useId();
  const search = useMemo(() => given ?? createPlaceSearch(), [given]);
  const [words, setWords] = useState("");
  const [found, setFound] = useState<readonly PlaceSuggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const asking = useRef<AbortController | undefined>(undefined);
  /** The name a choice put in the field: not something typed, so not asked about. */
  const chosen = useRef<string | undefined>(undefined);

  useEffect(() => {
    const typed = words.trim();
    if (typed.length < 2 || words === chosen.current) return undefined;
    const timer = setTimeout(() => {
      asking.current?.abort();
      const controller = new AbortController();
      asking.current = controller;
      search
        .suggest(typed, controller.signal)
        .then((suggestions) => {
          setFound(suggestions);
          setActive(-1);
          setOpen(true);
          setMessage(suggestions.length === 0 ? `No place found for “${typed}”.` : undefined);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setFound([]);
          setOpen(false);
          setMessage(
            `Places can't be searched now${cause instanceof Error ? ` (${cause.message})` : ""}.`,
          );
        });
    }, SUGGEST_AFTER_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [words, search]);

  useEffect(
    () => () => {
      asking.current?.abort();
    },
    [],
  );

  const choose = (suggestion: PlaceSuggestion) => {
    setOpen(false);
    chosen.current = suggestion.name;
    setWords(suggestion.name);
    asking.current?.abort();
    const controller = new AbortController();
    asking.current = controller;
    search
      .lookup(suggestion.id, controller.signal)
      .then((place) => {
        if (place === undefined) setMessage(`“${suggestion.name}” has no place to show.`);
        else {
          setMessage(undefined);
          onPlace(place);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setMessage("That place couldn't be found just now.");
      });
  };

  const listId = `${base}-places`;
  const shown = open && found.length > 0;
  return (
    <div className="place-search">
      <label htmlFor={`${base}-input`} className="visually-hidden">
        Find a place
      </label>
      <input
        id={`${base}-input`}
        type="search"
        role="combobox"
        autoComplete="off"
        spellCheck={false}
        placeholder="Find a place in the Netherlands"
        aria-expanded={shown}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={shown && active >= 0 ? `${base}-place-${String(active)}` : undefined}
        aria-describedby={message === undefined ? undefined : `${base}-message`}
        value={words}
        onChange={(event) => {
          setWords(event.target.value);
          if (event.target.value.trim().length < 2) {
            asking.current?.abort();
            setFound([]);
            setOpen(false);
            setMessage(undefined);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && found.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActive((index) => (index + 1) % found.length);
          } else if (event.key === "ArrowUp" && found.length > 0) {
            event.preventDefault();
            setOpen(true);
            setActive((index) => (index <= 0 ? found.length - 1 : index - 1));
          } else if (event.key === "Enter") {
            const chosen = found[active >= 0 ? active : 0];
            if (shown && chosen !== undefined) {
              event.preventDefault();
              choose(chosen);
            }
          } else if (event.key === "Escape" && shown) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
        onBlur={() => {
          setOpen(false);
        }}
      />
      <ul id={listId} role="listbox" aria-label="Places" className="place-list" hidden={!shown}>
        {found.map((suggestion, index) => (
          <li
            key={suggestion.id}
            id={`${base}-place-${String(index)}`}
            role="option"
            aria-selected={index === active}
            onMouseDown={(event) => {
              // Before the field's blur closes the list.
              event.preventDefault();
              choose(suggestion);
            }}
          >
            {suggestion.name}
          </li>
        ))}
      </ul>
      {message !== undefined && (
        <p id={`${base}-message`} className="place-message" role="status">
          {message}
        </p>
      )}
    </div>
  );
}
