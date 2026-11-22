import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import type * as Leaflet from 'leaflet';
import { Block, childProps } from '../block';

interface MarkerProps {
  label: string;
  lat: number;
  lng: number;
  description: string;
}

interface Place {
  label: string;
  description: string;
  lat: number;
  lng: number;
}

/** The pins that can be placed: a marker still streaming has no coordinates yet. */
export function places(value: unknown): Place[] {
  return childProps<MarkerProps>(value, 'Marker').flatMap((marker) => {
    const lat = Number(marker.lat);
    const lng = Number(marker.lng);
    const valid =
      marker.lat != null && marker.lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
    return valid
      ? [{ label: marker.label ?? '', description: marker.description ?? '', lat, lng }]
      : [];
  });
}

/**
 * A map with numbered pins, and the same places as a list under it. The map is Leaflet,
 * loaded when the first map is shown; its tiles come from OpenStreetMap, so showing a
 * map tells their servers which area is looked at. Without the network the list is
 * still there.
 */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  selector: 'gui-map',
  template: `<figure class="gui-map">
    @if (p.title) {
      <figcaption class="gui-chart-title">{{ p.title }}</figcaption>
    }
    <div #canvas class="gui-map-canvas" [class.gui-map-off]="failed()"></div>
    <ol class="gui-map-places">
      @for (place of places(); track $index) {
        <li>
          <button type="button" (click)="show($index)">
            <span class="gui-pin-number">{{ $index + 1 }}</span>
            <span class="gui-list-title">{{ place.label }}</span>
            @if (place.description) {
              <span class="gui-list-text">{{ place.description }}</span>
            }
          </button>
        </li>
      }
    </ol>
  </figure>`,
})
export class MapBlock extends Block<{
  markers: unknown;
  title: string;
  connect: boolean;
  focus: number;
}> {
  /** The places and route now on the map. */
  private drawn = '';
  private readonly canvas = viewChild.required<ElementRef<HTMLElement>>('canvas');
  protected readonly places = computed(() => places(this.props()?.markers));
  /** Leaflet could not be loaded or started: the list stands alone. */
  protected readonly failed = signal(false);

  private leaflet?: typeof Leaflet;
  private map?: Leaflet.Map;
  private layer?: Leaflet.LayerGroup;
  private pins: Leaflet.Marker[] = [];
  private loading = false;
  /** The reader moved the map: it is no longer reframed when a pin arrives. */
  private moved = false;
  private destroyed = false;

  constructor() {
    super();
    afterRenderEffect(() => {
      const all = this.places();
      const connect = !!this.props()?.connect;
      const focus = Number(this.props()?.focus) || 0;
      void this.draw(all, connect).then(() => this.focusOn(focus));
    });
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.map?.remove();
    });
  }

  private async draw(all: Place[], connect: boolean): Promise<void> {
    if (!all.length || this.failed()) {
      return;
    }
    if (!this.map) {
      if (this.loading) {
        return;
      }
      this.loading = true;
      try {
        // Leaflet is CommonJS: its API is the default export of the module.
        const module = await import('leaflet');
        this.leaflet = (module as { default?: typeof Leaflet }).default ?? module;
        if (this.destroyed) {
          return;
        }
        const L = this.leaflet;
        this.map = L.map(this.canvas().nativeElement, {
          // The thread scrolls with the wheel; the map zooms with its buttons or a pinch.
          scrollWheelZoom: false,
          attributionControl: true,
        });
        this.map.attributionControl.setPrefix(false);
        L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 18,
          attribution: '© OpenStreetMap',
        }).addTo(this.map);
        this.layer = L.layerGroup().addTo(this.map);
        this.map.on('dragstart zoomstart', () => {
          // Only what the reader does counts, not the framing done below.
          this.moved ||= this.framed;
        });
      } catch {
        this.failed.set(true);
        return;
      } finally {
        this.loading = false;
      }
      // The newest places may have arrived while Leaflet was loading.
      all = this.places();
      connect = !!this.props()?.connect;
    }

    // The reply is drawn again whenever its state changes: the pins only when they did.
    const drawing = JSON.stringify([all, connect]);
    if (drawing === this.drawn) {
      return;
    }
    this.drawn = drawing;

    const L = this.leaflet!;
    this.layer!.clearLayers();
    this.pins = all.map((place, index) => {
      const popup = document.createElement('div');
      const title = popup.appendChild(document.createElement('strong'));
      title.textContent = place.label;
      if (place.description) {
        popup.appendChild(document.createElement('span')).textContent = place.description;
      }
      return L.marker([place.lat, place.lng], {
        title: place.label,
        icon: L.divIcon({
          className: 'gui-pin',
          html: `<span>${index + 1}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          popupAnchor: [0, -14],
        }),
      })
        .bindPopup(popup)
        .addTo(this.layer!);
    });
    const points = all.map((place) => [place.lat, place.lng] as [number, number]);
    if (connect && points.length > 1) {
      L.polyline(points, { className: 'gui-route' }).addTo(this.layer!);
    }
    if (!this.moved) {
      this.framed = false;
      this.map!.invalidateSize();
      if (points.length === 1) {
        this.map!.setView(points[0], 12, { animate: false });
      } else {
        this.map!.fitBounds(L.latLngBounds(points), {
          padding: [36, 36],
          maxZoom: 14,
          animate: false,
        });
      }
      this.framed = true;
    }
  }

  /** Set once the map has been framed on its pins: what moves it after is the reader. */
  private framed = false;

  /** The pin last centred on at the reply's request, so that it is done once per change. */
  private focused = 0;

  /** Centres on the pin the reply points at, e.g. the place just clicked in a list. */
  private focusOn(focus: number): void {
    if (focus !== this.focused && this.pins[focus - 1]) {
      this.focused = focus;
      this.show(focus - 1);
    }
  }

  protected show(index: number): void {
    const pin = this.pins[index];
    if (!pin || !this.map) {
      return;
    }
    this.moved = true;
    this.map.setView(pin.getLatLng(), Math.max(this.map.getZoom(), 12));
    pin.openPopup();
  }
}
