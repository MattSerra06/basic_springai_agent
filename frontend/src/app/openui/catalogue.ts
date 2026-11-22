/*
 * The catalogue: every component the model may write in a reply, with the order and the
 * type of its arguments. It is the contract between the two sides of the app:
 *
 * - library.ts binds each name to the Angular component that draws it;
 * - scripts/openui-prompt.mjs turns the same definitions into the part of the system
 *   prompt the backend sends (backend/src/main/resources/openui/system-prompt.txt).
 *
 * So this file has no Angular in it, and only syntax Node can run as it is. After a
 * change here, run `npm run openui:prompt`; `npm test` fails while the prompt is stale.
 *
 * Arguments are positional, in the order of the keys: required ones first, and new
 * ones only ever at the end, or stored conversations stop rendering.
 */
import { tagSchemaId } from '@openuidev/lang-core';
import { z } from 'zod/v4';
import type { $ZodType } from 'zod/v4/core';

/** What a definition is made of; the renderer is added by whoever builds the library. */
export interface Definition {
  name: string;
  description: string;
  props: z.ZodObject;
}

/** A definition once registered: `ref` is how another component names it as a child. */
interface Defined {
  name: string;
  ref: $ZodType;
}

export interface ComponentGroup {
  name: string;
  components: string[];
  notes?: string[];
}

export const ROOT = 'Response';

/** `Action([@ToAssistant("…")])`, `Action([@OpenUrl("…")])`. */
const action = z.any();
tagSchemaId(action, 'ActionExpression');

const tone = z.enum(['info', 'success', 'warning', 'danger']);

/** `{ required: true, email: true, minLength: 2 }`; named Rules in the signatures. */
const rulesObject = z.object({
  required: z.boolean().optional(),
  email: z.boolean().optional(),
  url: z.boolean().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  minLength: z.number().optional(),
  maxLength: z.number().optional(),
});
tagSchemaId(rulesObject, 'Rules');
const rules = rulesObject.optional();

const cell = z.union([z.string(), z.number()]);

/**
 * Registers the catalogue with `define` (that of Angular in the browser, that of
 * lang-core in the prompt script) and returns what a library is created from.
 */
export function buildCatalogue<T extends Defined>(define: (definition: Definition) => T) {
  const all: T[] = [];
  const add = (name: string, description: string, shape: z.ZodRawShape): T => {
    const defined = define({ name, description, props: z.object(shape) });
    all.push(defined);
    return defined;
  };
  /** A slot that takes any of these components; `alias` is how the signatures name it. */
  const anyOf = (items: T[], alias?: string) => {
    const union = z.union(items.map((item) => item.ref) as [$ZodType, $ZodType, ...$ZodType[]]);
    if (alias) {
      tagSchemaId(union, alias);
    }
    return union;
  };

  // Text
  const Heading = add('Heading', 'A heading inside the answer. level defaults to "section".', {
    text: z.string(),
    level: z.enum(['section', 'sub']).optional(),
  });
  const TextContent = add(
    'TextContent',
    'Running text: one or more paragraphs separated by \\n\\n. Inline markdown only (**bold**, *italic*, `code`, [label](https://url)) and [1]-style citations of the Response sources. tone "lead" is for one opening sentence, "muted" for a side remark.',
    { text: z.string(), tone: z.enum(['body', 'lead', 'muted']).optional() },
  );
  const Callout = add(
    'Callout',
    'A boxed note that must not be missed: a takeaway, a caveat, a warning.',
    { variant: tone, title: z.string(), text: z.string() },
  );
  const Quote = add('Quote', 'A quotation, with who said it.', {
    text: z.string(),
    author: z.string().optional(),
  });
  const CodeBlock = add('CodeBlock', 'Source code or a command, shown verbatim.', {
    language: z.string(),
    code: z.string(),
  });
  const Separator = add('Separator', 'A rule between two unrelated parts.', {});

  // Links and media
  const LinkCards = add(
    'LinkCards',
    'Pages worth opening, as cards: recommended reading, products, documentation. Each opens in a new tab.',
    {
      links: z.array(
        z.object({ title: z.string(), url: z.string(), description: z.string().optional() }),
      ),
    },
  );
  const Image = add('Image', 'One image, by its public https URL.', {
    src: z.string(),
    alt: z.string(),
    caption: z.string().optional(),
  });
  const ImageGallery = add('ImageGallery', 'Two to six images side by side.', {
    images: z.array(z.object({ src: z.string(), alt: z.string() })),
  });

  // Data
  const Table = add(
    'Table',
    'A table, row by row. Every row has one cell per header. Numbers are passed as numbers; text cells accept inline markdown.',
    { headers: z.array(z.string()), rows: z.array(z.array(cell)), caption: z.string().optional() },
  );
  const KeyValues = add('KeyValues', 'A short fact sheet: label on the left, value on the right.', {
    items: z.array(z.object({ label: z.string(), value: z.string() })),
  });
  const Metrics = add(
    'Metrics',
    'One to four headline figures. value is preformatted text ("1,2 M€"); detail says what it is compared to; trend colours the detail.',
    {
      items: z.array(
        z.object({
          label: z.string(),
          value: z.string(),
          detail: z.string().optional(),
          trend: z.enum(['up', 'down', 'flat']).optional(),
        }),
      ),
    },
  );
  const Tags = add('Tags', 'A row of short labels.', { labels: z.array(z.string()) });

  // Charts
  const Series = add('Series', 'One named series of a chart: one value per label.', {
    name: z.string(),
    values: z.array(z.number()),
  });
  const Slice = add('Slice', 'One part of a PieChart.', { label: z.string(), value: z.number() });
  const chart = {
    labels: z.array(z.string()),
    series: z.array(Series.ref),
    title: z.string().optional(),
    unit: z.string().optional(),
  };
  const BarChart = add(
    'BarChart',
    'Vertical bars comparing a few categories, one group of bars per label. stacked piles the series up.',
    { ...chart, stacked: z.boolean().optional() },
  );
  const HorizontalBarChart = add(
    'HorizontalBarChart',
    'A ranking: one horizontal bar per label, best for long labels. Sort the values yourself.',
    {
      labels: z.array(z.string()),
      values: z.array(z.number()),
      title: z.string().optional(),
      unit: z.string().optional(),
    },
  );
  const LineChart = add('LineChart', 'Lines over an ordered axis: an evolution in time.', chart);
  const AreaChart = add('AreaChart', 'Like LineChart, filled: volumes over time.', chart);
  const PieChart = add('PieChart', 'Parts of a whole, two to six slices.', {
    slices: z.array(Slice.ref),
    title: z.string().optional(),
    unit: z.string().optional(),
  });

  // Map
  const Marker = add(
    'Marker',
    'A place on a Map, in decimal degrees (lat north positive, lng east positive).',
    { label: z.string(), lat: z.number(), lng: z.number(), description: z.string().optional() },
  );
  const Map = add(
    'Map',
    'An interactive map with numbered pins: places, an itinerary, where things are. connect draws the route from pin to pin, in order.',
    { markers: z.array(Marker.ref), title: z.string().optional(), connect: z.boolean().optional() },
  );

  // Lists
  const ListItem = add(
    'ListItem',
    'An item of a List. With an action it becomes clickable; without, plain text.',
    { title: z.string(), text: z.string().optional(), action: action.optional() },
  );
  const List = add('List', 'A list of items. style defaults to "bullet".', {
    items: z.array(ListItem.ref),
    style: z.enum(['bullet', 'number']).optional(),
  });
  const Step = add('Step', 'One step of Steps.', { title: z.string(), text: z.string() });
  const Steps = add('Steps', 'A procedure to follow in order: a recipe, a setup, a plan.', {
    items: z.array(Step.ref),
  });
  const Timeline = add('Timeline', 'Dated events in order: a history, a schedule, a trip.', {
    items: z.array(z.object({ when: z.string(), title: z.string(), text: z.string().optional() })),
  });

  // Actions
  const Button = add(
    'Button',
    'A button. Without an action it sends its label as the next user message. Exactly one button of a group is "primary".',
    {
      label: z.string(),
      action: action.optional(),
      variant: z.enum(['primary', 'secondary']).optional(),
    },
  );
  const Buttons = add('Buttons', 'A row of buttons.', { buttons: z.array(Button.ref) });
  const FollowUps = add(
    'FollowUps',
    'Two or three things the user may want to ask next, as clickable suggestions, written as the user would say them. Always last.',
    { suggestions: z.array(z.string()) },
  );

  // Cards
  const Card = add(
    'Card',
    'One card of Cards: a product, a place, an option. tag is one or two words; button acts on this card.',
    {
      title: z.string(),
      text: z.string(),
      image: z.string().optional(),
      tag: z.string().optional(),
      button: z.optional(Button.ref),
    },
  );
  const Cards = add(
    'Cards',
    'Two to six cards in a grid, to compare or choose between things of the same kind. Give every card the same arguments.',
    { items: z.array(Card.ref) },
  );

  // Forms
  const Input = add('Input', 'A one-line field.', {
    name: z.string(),
    placeholder: z.string().optional(),
    type: z.enum(['text', 'email', 'number', 'url']).optional(),
    rules,
  });
  const TextArea = add('TextArea', 'A field for several lines.', {
    name: z.string(),
    placeholder: z.string().optional(),
    rows: z.number().optional(),
    rules,
  });
  const SelectItem = add('SelectItem', 'An option of a Select.', {
    value: z.string(),
    label: z.string(),
  });
  const Select = add('Select', 'A dropdown, for more than four options.', {
    name: z.string(),
    items: z.array(SelectItem.ref),
    placeholder: z.string().optional(),
    rules,
  });
  const RadioItem = add('RadioItem', 'An option of a RadioGroup.', {
    value: z.string(),
    label: z.string(),
    description: z.string().optional(),
  });
  const RadioGroup = add('RadioGroup', 'One choice among two to four visible options.', {
    name: z.string(),
    items: z.array(RadioItem.ref),
    defaultValue: z.string().optional(),
    rules,
  });
  const CheckBoxItem = add('CheckBoxItem', 'A box of a CheckBoxGroup.', {
    value: z.string(),
    label: z.string(),
    description: z.string().optional(),
    checked: z.boolean().optional(),
  });
  const CheckBoxGroup = add('CheckBoxGroup', 'Any number of choices among a few options.', {
    name: z.string(),
    items: z.array(CheckBoxItem.ref),
  });
  const Slider = add('Slider', 'A number picked on a scale.', {
    name: z.string(),
    min: z.number(),
    max: z.number(),
    step: z.number().optional(),
    defaultValue: z.number().optional(),
    unit: z.string().optional(),
  });
  const DatePicker = add('DatePicker', 'A date.', { name: z.string(), rules });
  const FormControl = add('FormControl', 'A labelled field of a Form.', {
    label: z.string(),
    input: anyOf([Input, TextArea, Select, RadioGroup, CheckBoxGroup, Slider, DatePicker]),
    hint: z.string().optional(),
  });
  const Form = add(
    'Form',
    'Asks the user for several values at once. name is a unique id. The values typed are sent with the message of the button clicked.',
    { name: z.string(), buttons: Buttons.ref, fields: z.array(FormControl.ref) },
  );

  // Containers: they hold any block but another container.
  const blocks = [
    Heading,
    TextContent,
    Callout,
    Quote,
    CodeBlock,
    Separator,
    LinkCards,
    Image,
    ImageGallery,
    Table,
    KeyValues,
    Metrics,
    Tags,
    BarChart,
    HorizontalBarChart,
    LineChart,
    AreaChart,
    PieChart,
    Map,
    List,
    Steps,
    Timeline,
    Cards,
    Buttons,
    Form,
    FollowUps,
  ];
  const block = anyOf(blocks, 'Block');
  const Tab = add('Tab', 'One tab of Tabs.', { label: z.string(), content: z.array(block) });
  const Tabs = add('Tabs', 'Alternative views of the same subject, one visible at a time.', {
    items: z.array(Tab.ref),
  });
  const AccordionItem = add('AccordionItem', 'One section of an Accordion.', {
    title: z.string(),
    content: z.array(block),
  });
  const Accordion = add(
    'Accordion',
    'Sections folded under their titles, for details most readers skip.',
    { items: z.array(AccordionItem.ref) },
  );

  const Response = define({
    name: ROOT,
    description:
      'The root of every answer: its children stack from top to bottom. sources are the web pages the answer relies on, shown as links under it and cited in TextContent as [1], [2] (1-based).',
    props: z.object({
      children: z.array(anyOf([...blocks, Tabs, Accordion], 'Block | Tabs | Accordion')),
      sources: z
        .array(z.object({ title: z.string(), url: z.string(), publisher: z.string().optional() }))
        .optional(),
    }),
  });

  const groups: ComponentGroup[] = [
    {
      name: 'Root',
      components: [ROOT],
      notes: [`- Block is any of: ${blocks.map((item) => item.name).join(', ')}.`],
    },
    ...componentGroups,
  ];
  return { root: ROOT, components: [Response, ...all], componentGroups: groups };
}

export const componentGroups: ComponentGroup[] = [
  {
    name: 'Text',
    components: ['Heading', 'TextContent', 'Callout', 'Quote', 'CodeBlock', 'Separator'],
    notes: [
      '- TextContent carries the prose. Never put markdown headings, lists or tables in it: use Heading, List and Table.',
      '- Escape double quotes inside strings as \\" and line breaks as \\n.',
    ],
  },
  {
    name: 'Links and media',
    components: ['LinkCards', 'Image', 'ImageGallery'],
    notes: [
      '- Only use URLs you know to exist: those of your sources, those the user gave. Never invent a URL, for a page or for an image.',
      '- A page the answer relies on goes in the sources of Response, not in LinkCards.',
    ],
  },
  {
    name: 'Data',
    components: ['Table', 'KeyValues', 'Metrics', 'Tags'],
  },
  {
    name: 'Charts',
    components: [
      'BarChart',
      'HorizontalBarChart',
      'LineChart',
      'AreaChart',
      'PieChart',
      'Series',
      'Slice',
    ],
    notes: [
      '- Every Series has exactly one value per label. unit is a short suffix such as "€", "%" or "km".',
      '- Say in the text whether the figures are from a source, from the user, or illustrative.',
    ],
  },
  {
    name: 'Map',
    components: ['Map', 'Marker'],
    notes: [
      '- Use a Map whenever the answer is about places. Give coordinates only for places you can locate with confidence.',
    ],
  },
  {
    name: 'Lists',
    components: ['List', 'ListItem', 'Steps', 'Step', 'Timeline'],
  },
  {
    name: 'Cards',
    components: ['Cards', 'Card'],
  },
  {
    name: 'Layout',
    components: ['Tabs', 'Tab', 'Accordion', 'AccordionItem'],
    notes: ['- Tabs and Accordion go directly in Response; they cannot hold one another.'],
  },
  {
    name: 'Buttons and follow-ups',
    components: ['Buttons', 'Button', 'FollowUps'],
    notes: [
      '- A click on a Button or a suggestion reaches you as the next user message.',
      '- Action([@OpenUrl("https://…")]) opens a page instead: Button("Open the docs", Action([@OpenUrl("https://example.com")])).',
    ],
  },
  {
    name: 'Forms',
    components: [
      'Form',
      'FormControl',
      'Input',
      'TextArea',
      'Select',
      'SelectItem',
      'RadioGroup',
      'RadioItem',
      'CheckBoxGroup',
      'CheckBoxItem',
      'Slider',
      'DatePicker',
    ],
    notes: [
      '- Use a Form when you need two or more answers from the user before you can go on; for one question, just ask it.',
      '- Form(name, buttons, fields): always pass a Buttons reference with a primary Button.',
      '- Define each FormControl as its own statement. Never nest a Form in a Form.',
      '- Rules is an object, every key optional: { required: true, email: true, url: true, min: 1, max: 10, minLength: 2, maxLength: 100 }. The error messages are shown for you.',
    ],
  },
];

export const promptOptions = {
  preamble:
    'Your replies are rendered as an interface. Write every reply in openui-lang, the language described below, and in nothing else: no prose before or after it, no markdown fences. While you call tools, write nothing; the program is your final answer.',
  additionalRules: [
    'A short or conversational answer is just root = Response([t]) with one TextContent. Do not dress up a simple answer.',
    'Reach for the other components when they carry the content better than prose: a Table to compare, a chart for figures, a Map for places, Steps for a procedure, Cards to choose between things, LinkCards for pages to open, a Form to ask for several values.',
    'Write the text inside the components in the language of the user. Component names and enum values stay as they are.',
    'When you used web results, list the pages you relied on in the sources of Response, and cite them in the text as [1], [2].',
    'End an answer that opens onto next steps with FollowUps; skip it for small talk.',
    'Earlier replies of yours in the conversation may be plain text or openui-lang; always answer in openui-lang.',
  ],
  examples: [
    `Example 1 — a plain answer:

root = Response([t])
t = TextContent("Oui : \`git stash\` met de côté les modifications en cours, et \`git stash pop\` les rétablit.")`,

    `Example 2 — a comparison with web sources:

root = Response([intro, tbl, note, next], srcs)
intro = TextContent("Les deux offres couvrent le même besoin, à des prix différents [1][2].", "lead")
tbl = Table(["Offre", "Prix mensuel (€)", "Stockage"], [["Basique", 9, "100 Go"], ["Pro", 19, "1 To"]])
note = Callout("info", "À retenir", "L'offre Pro devient rentable au-delà de 200 Go.")
next = FollowUps(["Compare les garanties", "Laquelle pour une équipe de cinq ?"])
srcs = [{title: "Tarifs", url: "https://example.com/tarifs", publisher: "Example"}, {title: "Comparatif 2026", url: "https://example.org/comparatif"}]`,

    `Example 3 — figures and places:

root = Response([h, chart, map])
h = Heading("Fréquentation par ville")
chart = BarChart(["Lyon", "Nantes", "Lille"], [s1, s2], "Visiteurs par an", "k")
s1 = Series("2024", [320, 210, 180])
s2 = Series("2025", [355, 240, 175])
map = Map([m1, m2, m3], "Les trois sites")
m1 = Marker("Lyon", 45.764, 4.8357, "Site principal")
m2 = Marker("Nantes", 47.2184, -1.5536)
m3 = Marker("Lille", 50.6292, 3.0573)`,

    `Example 4 — asking for several values:

root = Response([ask, form])
ask = TextContent("Il me faut quelques précisions pour chiffrer le voyage.")
form = Form("trip", btns, [f1, f2, f3])
f1 = FormControl("Destination", Input("destination", "Lisbonne", "text", {required: true}))
f2 = FormControl("Budget", Slider("budget", 300, 3000, 100, 1200, "€"))
f3 = FormControl("Style", RadioGroup("style", [RadioItem("calm", "Tranquille"), RadioItem("busy", "Dense")], "calm"))
btns = Buttons([Button("Chiffrer le voyage", Action([@ToAssistant("Chiffre ce voyage")]), "primary")])`,
  ],
  toolCalls: false,
  bindings: false,
};
