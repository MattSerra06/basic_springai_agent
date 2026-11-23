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
import { markReactive, tagSchemaId } from '@openuidev/lang-core';
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

/** `Action([@ToAssistant("…")])`, `Action([@OpenUrl("…")])`, `Action([@Set($n, $n + 1)])`. */
const action = z.any();
tagSchemaId(action, 'ActionExpression');

/**
 * A slot for any component that stands on its own. It is not checked against a list, so
 * that containers nest freely; a name that is not in the catalogue is still left out.
 */
const block = z.any();
tagSchemaId(block, 'Block');

/**
 * An argument that takes a `$variable` and writes back to it: what is typed in the
 * field becomes the value of the variable, for every expression that reads it.
 */
function bound<S extends $ZodType>(schema: S): S {
  markReactive(schema);
  return schema;
}

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
    'Running text: one or more paragraphs separated by \\n\\n. Inline markdown only (**bold**, *italic*, ==highlighted==, `code`, [label](https://url)) and [1]-style citations of the Response sources. tone "lead" is for one opening sentence, "muted" for a side remark.',
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
    'An interactive map with numbered pins: places, an itinerary, where things are. connect draws the route from pin to pin, in order. focus is the number of the pin to centre on and open (1 for the first), usually a $variable set by a click elsewhere.',
    {
      markers: z.array(Marker.ref),
      title: z.string().optional(),
      connect: z.boolean().optional(),
      focus: z.number().optional(),
    },
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
    'A button. Without an action it sends its label as the next user message; with @Set it changes $variables in the browser. At most one button of a group is "primary"; "ghost" is quiet, "danger" resets or deletes. sound plays a short drum or beep on click.',
    {
      label: z.string(),
      action: action.optional(),
      variant: z.enum(['primary', 'secondary', 'ghost', 'danger']).optional(),
      size: z.enum(['s', 'm', 'l']).optional(),
      sound: z.enum(['kick', 'snare', 'hat', 'clap', 'tom', 'beep']).optional(),
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
    value: bound(z.union([z.string(), z.number()]).optional()),
  });
  const TextArea = add('TextArea', 'A field for several lines.', {
    name: z.string(),
    placeholder: z.string().optional(),
    rows: z.number().optional(),
    rules,
    value: bound(z.string().optional()),
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
    value: bound(z.string().optional()),
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
    value: bound(z.string().optional()),
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
    value: bound(z.number().optional()),
  });
  const DatePicker = add('DatePicker', 'A date, as YYYY-MM-DD.', {
    name: z.string(),
    rules,
    value: bound(z.string().optional()),
  });
  const Switch = add('Switch', 'An on/off setting.', {
    name: z.string(),
    label: z.string(),
    value: bound(z.boolean().optional()),
  });
  const Chips = add(
    'Chips',
    'One choice among a few short options, as pills: a filter, a mode, a category. The value is the text of the chosen option.',
    { name: z.string(), options: z.array(z.string()), value: bound(z.string().optional()) },
  );
  const FormControl = add('FormControl', 'A labelled field of a Form.', {
    label: z.string(),
    input: anyOf([
      Input,
      TextArea,
      Select,
      RadioGroup,
      CheckBoxGroup,
      Slider,
      DatePicker,
      Switch,
      Chips,
    ]),
    hint: z.string().optional(),
  });
  const Form = add(
    'Form',
    'Asks the user for several values at once. name is a unique id. The values typed are sent with the message of the button clicked.',
    { name: z.string(), buttons: Buttons.ref, fields: z.array(FormControl.ref) },
  );

  // Mini-apps: what shows and keeps a state in the browser
  const Display = add(
    'Display',
    'A large readout: the screen of a calculator, a counter, a score, a result. Pass a number as it is ($count) and it is formatted; label is a small line above it.',
    { value: z.union([z.string(), z.number()]), label: z.string().optional() },
  );
  const Progress = add(
    'Progress',
    'A bar filled from 0 to max (100 by default): progress, a level, a share.',
    { value: z.number(), max: z.number().optional(), label: z.string().optional() },
  );
  const Timer = add(
    'Timer',
    'A clock that runs in the browser, with start, pause and reset: a countdown from seconds, or a stopwatch when seconds is 0 or omitted. done runs when a countdown reaches zero.',
    {
      seconds: z.number().optional(),
      title: z.string().optional(),
      autoStart: z.boolean().optional(),
      done: action.optional(),
    },
  );
  const Checklist = add(
    'Checklist',
    'A list the user ticks off in the browser: tasks, a packing list, ingredients. With editable the user can also add and remove items: a to-do list.',
    { items: z.array(z.string()), title: z.string().optional(), editable: z.boolean().optional() },
  );

  // Layout: containers hold any block, and one another
  const Stack = add(
    'Stack',
    'Lays its children out in a column (default) or a row. A row wraps unless wrap is false, in which case it scrolls sideways.',
    {
      children: z.array(block),
      direction: z.enum(['column', 'row']).optional(),
      gap: z.enum(['s', 'm', 'l']).optional(),
      align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
      justify: z.enum(['start', 'center', 'end', 'between']).optional(),
      wrap: z.boolean().optional(),
    },
  );
  const Grid = add(
    'Grid',
    'Lays its children out in equal columns, row after row: a keypad, a board of pads, a dashboard of panels. On a phone more than four columns fold.',
    { children: z.array(block), columns: z.number(), gap: z.enum(['s', 'm', 'l']).optional() },
  );
  const Panel = add(
    'Panel',
    'A framed surface that groups blocks into one object: an app, a widget, a section of a dashboard. tone changes its material: "frame" (default) is a frame on the page, "paper" a white sheet, "wood" a board of oak, "accent" the orange of the app, for the one panel that matters most.',
    {
      children: z.array(block),
      title: z.string().optional(),
      tone: z.enum(['frame', 'paper', 'wood', 'accent']).optional(),
    },
  );
  const Columns = add(
    'Columns',
    'Columns of unequal widths, each one a list of blocks: a main column with a side column ([2, 1]), a narrow index beside a body ([1, 3]), three columns ([1, 1, 1]). widths are the shares of the columns; equal when omitted. On a phone the columns stack.',
    { columns: z.array(z.array(block)), widths: z.array(z.number()).optional() },
  );
  const Hero = add(
    'Hero',
    'A banner that opens a page on one statement: the headline of a front page, the answer in a sentence, the name of a place. kicker is a short line above the title. tone "accent" (default) is the orange of the app, "wood" its oak, "paper" a white sheet.',
    {
      title: z.string(),
      text: z.string().optional(),
      kicker: z.string().optional(),
      tone: z.enum(['accent', 'wood', 'paper']).optional(),
      buttons: z.optional(Buttons.ref),
    },
  );
  const WizardStep = add('WizardStep', 'One step of a Wizard.', {
    title: z.string(),
    content: z.array(block),
  });
  const Wizard = add(
    'Wizard',
    'A path taken one step at a time, with previous and next and the progress shown: a setup, a questionnaire, a guided choice, a recipe followed at the stove. Only the current step is drawn; fields keep their values from one step to the next. done is the action of the button that ends the last step, labelled doneLabel.',
    {
      steps: z.array(WizardStep.ref),
      doneLabel: z.string().optional(),
      done: action.optional(),
    },
  );
  const Carousel = add(
    'Carousel',
    'Blocks of the same kind set side by side and browsed sideways, with arrows, the keyboard or a swipe: photos, cards, quotes, options. perView is how many are seen at once on a wide screen (1 to 3, default 1).',
    { items: z.array(block), title: z.string().optional(), perView: z.number().optional() },
  );
  const HtmlView = add(
    'HtmlView',
    'A page of your own design, in free HTML, drawn in an isolated frame that the user can open full screen: a mock-up, a landing page, a poster, a small game, an animation, a visual no component can draw. html is one complete, self-contained document with its <style> and <script> inline. height is that of the frame in the reply, in pixels (default 420).',
    { title: z.string(), html: z.string(), height: z.number().optional() },
  );
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
      children: z.array(block),
      sources: z
        .array(z.object({ title: z.string(), url: z.string(), publisher: z.string().optional() }))
        .optional(),
    }),
  });

  /** What stands on its own; the rest is a part of one of these. */
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
    Button,
    Buttons,
    FollowUps,
    Form,
    FormControl,
    Input,
    TextArea,
    Select,
    RadioGroup,
    CheckBoxGroup,
    Slider,
    DatePicker,
    Switch,
    Chips,
    Display,
    Progress,
    Timer,
    Checklist,
    Stack,
    Grid,
    Panel,
    Columns,
    Hero,
    Wizard,
    Carousel,
    HtmlView,
    Tabs,
    Accordion,
  ];
  const groups: ComponentGroup[] = [
    {
      name: 'Root',
      components: [ROOT],
      notes: [
        `- Block is any of: ${blocks.map((item) => item.name).join(', ')}.`,
        '- A Block slot also takes an expression that gives a Block or null: $tab == "map" ? map : list.',
      ],
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
      '- ==Two equal signs== around a few words highlight them in orange, like a marker pen, wherever inline markdown is read (TextContent, Callout, Quote, cards, lists, table cells). Use it for what the reader must not miss: the figure, the date, the verdict. A few words at a time, one or two highlights per answer, never a whole sentence.',
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
    components: [
      'Stack',
      'Grid',
      'Panel',
      'Columns',
      'Hero',
      'Wizard',
      'WizardStep',
      'Carousel',
      'Tabs',
      'Tab',
      'Accordion',
      'AccordionItem',
    ],
    notes: [
      '- Response already stacks its children: reach for a layout only to put things side by side or to frame them.',
      '- Side by side: Stack([a, b], "row"). Equal columns: Grid([...], 3). A keypad is a Grid of Buttons. Containers nest.',
      '- A page is not a pile of blocks. Open it on a Hero; give the main piece two thirds of the width and the rest a side column with Columns([[main], [side1, side2]], [2, 1]); set things of one kind in a Carousel; change the tone of the one Panel that matters.',
      '- Columns takes a list of lists: each inner list is one column, from top to bottom.',
      '- A Wizard is for what the user goes through on screen, one step at a time. A procedure that is only read is Steps.',
      '- Show or hide a block with a ternary where it stands: $step == 2 ? details : null.',
    ],
  },
  {
    name: 'Free HTML',
    components: ['HtmlView'],
    notes: [
      '- Use the components for all they can draw: they follow the theme of the app and its two colour schemes. HtmlView is for the rest: a layout, a drawing or a behaviour that must be free. Asked for "a page", "a mock-up", "a site", "a game" or "in HTML", that is an HtmlView.',
      '- The frame is sealed: no network at all (no CDN, no web font, no image by URL, no fetch), no link to another page, no storage, no form sent. Everything is inline: CSS in <style>, JavaScript in <script>, drawings in inline SVG or CSS.',
      '- Give the page its own background and colours, and make it fit any width: it is seen in a narrow column, then full screen.',
      '- Inside html, write attributes with single quotes and line breaks as \\n, so that only double quotes inside scripts need a backslash.',
      '- One HtmlView per reply, with a sentence of TextContent before it. It cannot read the $variables of the reply, nor send you a message.',
    ],
  },
  {
    name: 'Buttons and follow-ups',
    components: ['Buttons', 'Button', 'FollowUps'],
    notes: [
      '- A Button without an action, with @ToAssistant, or a suggestion, reaches you as the next user message.',
      '- Action([@OpenUrl("https://…")]) opens a page instead: Button("Open the docs", Action([@OpenUrl("https://example.com")])).',
      '- Action([@Set($n, $n + 1)]) changes a $variable in the browser, at once, without reaching you. Steps run in order, each seeing what the previous one set.',
    ],
  },
  {
    name: 'Mini-apps',
    components: ['Display', 'Progress', 'Timer', 'Checklist'],
    notes: [
      '- Asked for a tool or a small app (calculator, counter, converter, timer, quiz, tracker, to-do list, picker), build one that WORKS in the browser: its state in $variables, Buttons with @Set, fields bound to a $variable, and expressions for what is shown.',
      '- Never use @ToAssistant for what the browser can compute: the app must react to a click at once.',
      '- $variables hold a number, a text or true/false, never a list. Declare each with its default just under root: $count = 0.',
      '- Arithmetic needs numbers. An Input of type "number", a Slider and @Set($n, $n * 10 + 7) give numbers; + joins as text as soon as one side is text.',
      '- An expression can be a statement of its own and be reused by name, in arguments and in actions: total = $price * $qty.',
      '- Time and lists that grow are not expressions: a clock is a Timer, a list the user edits is a Checklist with editable.',
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
      'Switch',
      'Chips',
    ],
    notes: [
      '- A field also works outside a Form: pass a $variable as its value, and what the user types is that variable, live: Input("km", "0", "number", null, $km) then Display($km * 0.621).',
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
    'Only a greeting, a one-line fact, a yes or no, or a question back to the user is a plain answer: root = Response([t]) with one TextContent.',
    'Every other answer is a page you design, not paragraphs under a title. Work like the art director of a magazine: decide what the reader must see first, then give each kind of content the component made for it. A Heading followed by a stack of TextContent blocks is a failed answer: do not wait to be asked to present it better.',
    'Compose with several kinds of components, usually three or more: Metrics for the two to four figures that matter, a chart when there is a series of numbers, a Table to compare, a Map for places, a Timeline for dates, Steps for a procedure, Cards for things of the same kind, Tags for themes, a Callout for the takeaway or the caveat, a Quote for what someone said, LinkCards for pages to open, a Form to ask for several values, Tabs or an Accordion when there is a lot.',
    'Lay the page out: a Heading and one "lead" sentence, then the main piece framed in a Panel, then the rest side by side in a Grid or as Cards. Keep the prose inside a component to one to three sentences: what is longer becomes structure.',
    'A digest (the news, several topics, the results of a search) is a front page: one story gets more room than the others, the rest is grouped, the figures are pulled out of the prose. Which components do that is yours to choose, from what the stories are made of.',
    'Pick the components from the content, and vary the page from one reply to the next: never the same skeleton twice in a row. A Panel then a Grid is one composition among many: a Hero then Columns, a Carousel of cards, a Wizard, Tabs are others.',
    'The examples at the end only show syntax, on small subjects chosen to be unlike what you will be asked. Never take their layout, their choice of components or their wording as a model for an answer.',
    'Never invent content to fill a component: a chart needs real figures, a Map places you can locate, an Image a URL you know. When the data is missing, choose another component.',
    'Asked to make, build or show something to use (a calculator, a timer, a tracker, a planner, a finder), answer with the working interface itself, in a Panel, not with an explanation of how one would build it.',
    'Write the text inside the components in the language of the user. Component names and enum values stay as they are.',
    'When you used web results, list the pages you relied on in the sources of Response, and cite them in the text as [1], [2].',
    'End an answer that opens onto next steps with FollowUps; skip it for small talk.',
    'Earlier replies of yours in the conversation may be plain text or openui-lang; always answer in openui-lang.',
  ],
  examples: [
    `Syntax 1 — a plain answer:

root = Response([t])
t = TextContent("Oui : \`git stash\` met de côté les modifications en cours, et \`git stash pop\` les rétablit.")`,

    `Syntax 2 — statements referenced by name, numbers passed as numbers, a source cited, a few words highlighted:

root = Response([lead, tbl], srcs)
lead = TextContent("Un lichen crustacé gagne ==moins d'un millimètre par an== [1].", "lead")
tbl = Table(["Espèce", "Croissance (mm/an)"], [["Rhizocarpon", 0.5], ["Xanthoria", 2.5]])
srcs = [{title: "La croissance des lichens", url: "https://example.org/lichens", publisher: "Example"}]`,

    `Syntax 3 — containers nest, and take components written in place:

root = Response([row])
row = Grid([morning, later], 2)
morning = Panel([Metrics([{label: "Pleine mer", value: "06:42", detail: "coefficient 87"}])], "Matin")
later = Panel([Timeline([{when: "12:55", title: "Basse mer"}, {when: "19:10", title: "Pleine mer"}])], "Suite de la journée")`,

    `Syntax 4 — a $variable changed by a click, in the browser:

root = Response([app])
$laps = 0
app = Panel([Display($laps, "Tours de piste"), keys])
keys = Buttons([Button("Un tour de plus", Action([@Set($laps, $laps + 1)]), "primary"), Button("Remettre à zéro", Action([@Reset($laps)]), "ghost")])`,

    `Syntax 5 — a field bound to a $variable, an expression reused by name, a block shown on a condition:

root = Response([field, out, $celsius > 100 ? note : null])
$celsius = 20
kelvin = $celsius + 273.15
field = FormControl("Température (°C)", Input("celsius", "0", "number", null, $celsius))
out = Display(@Round(kelvin, 2), "Kelvin")
note = Callout("warning", "Au-dessus de 100 °C", "L'eau bout, au niveau de la mer.")`,

    `Syntax 6 — a Form whose values reach you with the message of its button:

root = Response([form])
form = Form("parcel", btns, [f1, f2])
f1 = FormControl("Poids", Slider("weight", 1, 30, 1, 5, "kg"))
f2 = FormControl("Livraison", RadioGroup("speed", [RadioItem("slow", "Économique"), RadioItem("fast", "Express")], "slow"))
btns = Buttons([Button("Estimer l'envoi", Action([@ToAssistant("Estime l'envoi de ce colis")]), "primary")])`,

    `Syntax 7 — columns are lists of blocks; the steps of a Wizard hold blocks too:

root = Response([cols, path])
cols = Columns([[TextContent("Le lichen pousse sur la roche nue.")], [Tags(["Roche", "Écorce"])]], [2, 1])
path = Wizard([WizardStep("Humidifier", [TextContent("Vaporiser de l'eau de pluie.")]), WizardStep("Attendre", [Timer(120, "Repos")])])`,

    `Syntax 8 — an HtmlView: one self-contained document, single quotes inside, \\n for line breaks:

root = Response([say, view])
say = TextContent("Voici le nuancier.")
view = HtmlView("Nuancier", "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1d3a;color:#f5e9c8;font:600 2rem system-ui}</style>\\n<p onclick='this.textContent=Date.now()'>Bleu de minuit</p>", 240)`,
  ],
  toolCalls: false,
  bindings: true,
};
