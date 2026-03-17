/**
 * GameScene — Phaser 3 main scene
 * Manages rendering layers: MapLayer → ZoneLayer → SpriteLayer → EffectLayer → UILayer
 * Handles zoom (mouse wheel), pan (drag), and responsive resize.
 * Requirements: 6.1, 6.2, 6.7, 6.8, 6.10, 2.9, 2.10
 */

import Phaser from 'phaser';
import { useGameStore } from '../stores/gameStore';
import { SpriteManager } from './sprite-manager';
import type { Zone, GameMap } from '../../../server/src/types/index';

// Zoom limits
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3.0;
const ZOOM_STEP = 0.1;

// Zone type → icon texture key mapping
const ZONE_TYPE_ICONS: Record<string, string> = {
  rest: 'icon_rest',
  work: 'icon_work',
  social: 'icon_social',
};

interface ZoneGraphics {
  fill: Phaser.GameObjects.Graphics;
  border: Phaser.GameObjects.Graphics;
  nameLabel: Phaser.GameObjects.Text;
  icon: Phaser.GameObjects.Image;
}

export class GameScene extends Phaser.Scene {
  // Rendering containers (layers)
  private mapLayer!: Phaser.GameObjects.Container;
  private zoneLayer!: Phaser.GameObjects.Container;
  private spriteLayer!: Phaser.GameObjects.Container;
  private effectLayer!: Phaser.GameObjects.Container;
  private uiLayer!: Phaser.GameObjects.Container;

  // Camera / pan state
  private isDragging = false;
  private dragStartX = 0;
  private dragStartY = 0;
  private camScrollX = 0;
  private camScrollY = 0;

  // Zone graphics cache
  private zoneGraphics = new Map<string, ZoneGraphics>();

  // Sprite manager (task 17.2)
  private spriteManager!: SpriteManager;

  // Zustand unsubscribe handle
  private unsubscribeStore: (() => void) | null = null;

  // Current map dimensions
  private mapWidth = 1600;
  private mapHeight = 900;

  constructor() {
    super({ key: 'GameScene' });
  }

  create(): void {
    this.createLayers();
    this.setupInputHandlers();
    this.setupResizeHandler();
    this.subscribeToStore();

    // Instantiate SpriteManager — Req 6.3, 6.4, 6.9, 1.8, 9.7, 9.11, 11.7
    this.spriteManager = new SpriteManager(this, this.spriteLayer);

    // Initial render from current store state
    const state = useGameStore.getState();
    if (state.map) {
      this.renderMap(state.map);
    }
    state.zones.forEach((zone) => this.renderZone(zone));
  }

  // ── Layer setup ─────────────────────────────────────────────────────────────

  private createLayers(): void {
    this.mapLayer = this.add.container(0, 0);
    this.zoneLayer = this.add.container(0, 0);
    this.spriteLayer = this.add.container(0, 0);
    this.effectLayer = this.add.container(0, 0);
    this.uiLayer = this.add.container(0, 0);

    // Depth order (bottom → top)
    this.mapLayer.setDepth(0);
    this.zoneLayer.setDepth(1);
    this.spriteLayer.setDepth(2);
    this.effectLayer.setDepth(3);
    this.uiLayer.setDepth(4);
  }

  // ── Map rendering ───────────────────────────────────────────────────────────

  private renderMap(map: GameMap): void {
    this.mapWidth = map.width;
    this.mapHeight = map.height;

    // Clear existing map layer children
    this.mapLayer.removeAll(true);

    if (map.backgroundImage) {
      // If a background image key is loaded, use it
      if (this.textures.exists(map.backgroundImage)) {
        const bg = this.add.image(0, 0, map.backgroundImage).setOrigin(0, 0);
        this.mapLayer.add(bg);
        return;
      }
    }

    // Fallback: procedural background
    const bg = this.add.image(0, 0, 'map_bg').setOrigin(0, 0);
    // Scale to match map dimensions
    bg.setDisplaySize(map.width, map.height);
    this.mapLayer.add(bg);
  }

  // ── Zone rendering ──────────────────────────────────────────────────────────

  private renderZone(zone: Zone): void {
    // Remove old graphics if re-rendering
    this.removeZoneGraphics(zone.id);

    const { x1, y1, x2, y2 } = zone.bounds;
    const w = x2 - x1;
    const h = y2 - y1;
    const cx = x1 + w / 2;

    // Parse fill color (hex string like '#3a3a6e' or number)
    const fillColor = this.parseColor(zone.style.fillColor, 0x3a3a6e);
    const borderColor = this.parseColor(zone.style.borderColor, 0x7986cb);
    const alpha = zone.style.opacity ?? 0.4;

    // Fill rectangle
    const fill = this.add.graphics();
    fill.fillStyle(fillColor, alpha);
    fill.fillRect(x1, y1, w, h);

    // Border rectangle
    const border = this.add.graphics();
    border.lineStyle(2, borderColor, 1);
    border.strokeRect(x1, y1, w, h);

    // Zone type icon
    const iconKey = this.getZoneIconKey(zone.zoneTypeId);
    const icon = this.add.image(x1 + 20, y1 + 20, iconKey).setDisplaySize(24, 24);

    // Zone name label
    const nameLabel = this.add.text(cx, y1 + 8, zone.name, {
      fontSize: '14px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
      fontFamily: 'Arial, sans-serif',
    }).setOrigin(0.5, 0);

    this.zoneLayer.add([fill, border, icon, nameLabel]);

    this.zoneGraphics.set(zone.id, { fill, border, nameLabel, icon });
  }

  private removeZoneGraphics(zoneId: string): void {
    const existing = this.zoneGraphics.get(zoneId);
    if (!existing) return;
    existing.fill.destroy();
    existing.border.destroy();
    existing.nameLabel.destroy();
    existing.icon.destroy();
    this.zoneGraphics.delete(zoneId);
  }

  private getZoneIconKey(zoneTypeId: string): string {
    // zoneTypeId may be 'rest', 'work', 'social' or a UUID for custom types
    const lower = zoneTypeId.toLowerCase();
    for (const [key, texture] of Object.entries(ZONE_TYPE_ICONS)) {
      if (lower.includes(key)) return texture;
    }
    return 'icon_default';
  }

  private parseColor(colorStr: string | undefined, fallback: number): number {
    if (!colorStr) return fallback;
    if (typeof colorStr === 'number') return colorStr;
    const hex = colorStr.replace('#', '');
    const parsed = parseInt(hex, 16);
    return isNaN(parsed) ? fallback : parsed;
  }

  // ── Input: zoom & pan ───────────────────────────────────────────────────────

  private setupInputHandlers(): void {
    // Mouse wheel zoom
    this.input.on('wheel', (_pointer: Phaser.Input.Pointer, _gameObjects: unknown, _dx: number, dy: number) => {
      const cam = this.cameras.main;
      const newZoom = Phaser.Math.Clamp(
        cam.zoom + (dy < 0 ? ZOOM_STEP : -ZOOM_STEP),
        MIN_ZOOM,
        MAX_ZOOM,
      );
      cam.setZoom(newZoom);
    });

    // Drag pan
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (pointer.rightButtonDown()) return;
      this.isDragging = true;
      this.dragStartX = pointer.x;
      this.dragStartY = pointer.y;
      this.camScrollX = this.cameras.main.scrollX;
      this.camScrollY = this.cameras.main.scrollY;
    });

    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (!this.isDragging) return;
      const cam = this.cameras.main;
      const dx = (pointer.x - this.dragStartX) / cam.zoom;
      const dy = (pointer.y - this.dragStartY) / cam.zoom;
      cam.setScroll(this.camScrollX - dx, this.camScrollY - dy);
    });

    this.input.on('pointerup', () => {
      this.isDragging = false;
    });

    this.input.on('pointerupoutside', () => {
      this.isDragging = false;
    });
  }

  // ── Responsive resize ───────────────────────────────────────────────────────

  private setupResizeHandler(): void {
    this.scale.on('resize', this.onResize, this);
    // Initial fit
    this.fitCameraToMap();
  }

  private onResize(): void {
    this.fitCameraToMap();
  }

  private fitCameraToMap(): void {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    // Fit map into viewport while maintaining aspect ratio
    const scaleX = width / this.mapWidth;
    const scaleY = height / this.mapHeight;
    const fitZoom = Math.min(scaleX, scaleY, MAX_ZOOM);
    cam.setZoom(Math.max(fitZoom, MIN_ZOOM));
    cam.centerOn(this.mapWidth / 2, this.mapHeight / 2);
  }

  // ── Zustand store subscription ──────────────────────────────────────────────

  private subscribeToStore(): void {
    // Subscribe to map changes
    this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
      if (state.map !== prev.map && state.map) {
        this.renderMap(state.map);
        this.fitCameraToMap();
      }

      // Re-render zones that changed
      state.zones.forEach((zone, id) => {
        if (zone !== prev.zones.get(id)) {
          this.renderZone(zone);
        }
      });

      // Remove zones that were deleted
      prev.zones.forEach((_zone, id) => {
        if (!state.zones.has(id)) {
          this.removeZoneGraphics(id);
        }
      });
    });
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  shutdown(): void {
    this.spriteManager?.destroy();
    this.unsubscribeStore?.();
    this.scale.off('resize', this.onResize, this);
  }

  // Expose layers for SpriteManager (task 17.2)
  getSpriteLayer(): Phaser.GameObjects.Container {
    return this.spriteLayer;
  }

  getEffectLayer(): Phaser.GameObjects.Container {
    return this.effectLayer;
  }

  getUILayer(): Phaser.GameObjects.Container {
    return this.uiLayer;
  }
}
