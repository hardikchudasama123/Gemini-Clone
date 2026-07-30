const SUGGESTIONS = [
  {
    title: 'Explain a hard idea simply',
    prompt: 'Explain how public-key cryptography works, using an analogy a 12-year-old would get.',
  },
  {
    title: 'Debug some code',
    prompt:
      'My JavaScript promise chain resolves before my async loop finishes. Here is the pattern I used — what am I doing wrong?\n\n```js\nitems.forEach(async (item) => {\n  await save(item);\n});\nconsole.log("all done");\n```',
  },
  {
    title: 'Plan a trip',
    prompt: 'Plan a 5-day itinerary for Kyoto in November. I like food, temples, and long walks.',
  },
  {
    title: 'Draft a message',
    prompt:
      'Write a short, friendly email asking my manager to approve a conference budget of $1,800. Keep it under 120 words.',
  },
];

export default function Welcome({ greeting, onPick }) {
  return (
    <div className="welcome">
      <h1 className="welcome-title">{greeting}</h1>
      <p className="welcome-sub">How can I help you today?</p>

      <ul className="suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <li key={suggestion.title}>
            <button type="button" onClick={() => onPick(suggestion.prompt)}>
              <strong>{suggestion.title}</strong>
              <span>{suggestion.prompt.split('\n')[0]}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
