import { Type } from '@angular/core';
import { createLibrary, defineComponent } from '@openuidev/angular-lang';
import { buildCatalogue } from './catalogue';
import { Button, Buttons, Cards, FollowUps } from './components/actions';
import { Checklist, Display, Progress, Timer } from './components/apps';
import { AreaChart, BarChart, HorizontalBarChart, LineChart, PieChart } from './components/charts';
import { KeyValues, List, Metrics, Steps, Table, Timeline } from './components/data';
import {
  CheckBoxGroup,
  Chips,
  DatePicker,
  Form,
  FormControl,
  Input,
  RadioGroup,
  Select,
  Slider,
  Switch,
  TextArea,
} from './components/forms';
import { Accordion, Grid, Panel, Part, Response, Stack, Tabs } from './components/layout';
import { MapBlock } from './components/map';
import { Carousel, Columns, Hero, HtmlView, Wizard } from './components/views';
import {
  Callout,
  CodeBlock,
  Heading,
  ImageBlock,
  ImageGallery,
  LinkCards,
  Quote,
  Separator,
  Tags,
  TextContent,
} from './components/text';

/**
 * What draws each component of the catalogue. A name that is missing here is drawn by
 * its parent from its arguments (a Series by its chart, a Tab by its Tabs).
 */
const renderers: Record<string, Type<unknown>> = {
  Response,
  Heading,
  TextContent,
  Callout,
  Quote,
  CodeBlock,
  Separator,
  LinkCards,
  Image: ImageBlock,
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
  Map: MapBlock,
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
};

/** The library the renderer draws with: the catalogue, bound to its Angular components. */
export const library = createLibrary(
  buildCatalogue((definition) =>
    defineComponent({ ...definition, component: renderers[definition.name] ?? Part }),
  ),
);
