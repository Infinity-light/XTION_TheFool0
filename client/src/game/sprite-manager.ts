/**
 * SpriteManager — manages Contestant sprites in the Phaser 3 GameScene.
 *
 * Each contestant is represented by a sprite group:
 *   - image (contestant texture)
 *   - name label (text)
 *   - status dot (connection status indicator)
 *   - heartbeat indicator (color-coded circle)
 *   - energy-depleted label ("精力耗尽")
 *
 * Requirements: 6.3, 6.4, 6.9, 1.8, 9.7, 9.11, 11.7
 */

import Phaser from 'phaser';
import { useGameStore } from '../stores/gameStore';
import { useUiStore } from '../stores/uiStore';
import type { Contestant } from '../../../server/src/types/index';
import type { HealthStatus } from '../../../server/src/types/index';

// ── Constants ────────────────────────────────────────────────────────────────

/** Tween duration range for movement (ms) */
const TWEEN_MIN_MS = 300;
const TWEEN_MAX_MS = 1000;

/** Sprite dimensions */
const SPRITE_SIZE = 40;

/** Status dot colors (connection status) — Req 1.8 */
const STATUS_DOT_COLORS: Record<Contestant['status'], number> = {
  online: 0x00e676,
  busy: 0xffab40,
  offline: 0x9e9e9e,
  timeout: 0xef5350,
};

/** Heartbeat indicator colors — Req 9.11 */
const HEARTBEAT_COLORS: Record<HealthStatus, number> = {
  healthy: 0x00e676,   // green
  delayed: 0xffeb3b,   // yellow
  timeout: 0xef5350,   // red
  offline: 0x9e9e9e,   // grey
};

/** Timeout state: gray semi-transparent alpha — Req 9.7 */
const TIMEOUT_ALPHA = 0.45;
const NORMAL_ALPHA = 1.0;

// ── Types ────────────────────────────────────────────────────────────────────

interface SpriteGroup {
  container: Phaser.GameObjects.Container;
  image: Phaser.GameObjects.Image;
  nameLabel: Phaser.GameObjects.Text;
  statusDot: Phaser.GameObjects.Arc;
  heartbeatDot: Phaser.GameObjects.Arc;
  energyLabel: Phaser.GameObjects.Text;
  healthStatus: HealthStatus;
  tween: Phaser.Tweens.Tween | null;
}

// ── SpriteManager ────────────────────────────────────────────────────────────

export class SpriteManager {
  private scene: Phaser.Scene;
  private spriteLayer: Phaser.GameObjects.Container;
  private sprites = new Map<string, SpriteGroup>();
  private unsubscribeStore: (() => void) | null = null;

  constructor(scene: Phaser.Scene, spriteLayer: Phaser.GameObjects.Container) {
    this.scene = scene;
    this.spriteLayer = spriteLayer;
    this.subscribeToStore();
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /** Add a new contestant sprite. */
  addContestant(contestant: Contestant): void {
    if (this.sprites.has(contestant.id)) {
      this.updateContestant(contestant);
      return;
    }

    const { x, y } = contestant.position;

    // Base image — uses 'contestant' texture loaded in BootScene
    const image = this.scene.add.image(0, 0, 'contestant')
      .setDisplaySize(SPRITE_SIZE, SPRITE_SIZE)
      .setOrigin(0.5, 0.5);

    // Name label — above sprite
    const nameLabel = this.scene.add.text(0, -(SPRITE_SIZE / 2 + 14), contestant.name, {
      fontSize: '12px',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
      fontFamily: 'Arial, sans-serif',
    }).setOrigin(0.5, 1);

    // Status dot (connection status) — bottom-right of sprite — Req 1.8
    const statusDot = this.scene.add.arc(
      SPRITE_SIZE / 2 - 4,
      SPRITE_SIZE / 2 - 4,
      5,
      0, 360,
      false,
      STATUS_DOT_COLORS[contestant.status] ?? 0x9e9e9e,
      1,
    );

    // Heartbeat indicator — top-right of sprite — Req 9.11
    const heartbeatDot = this.scene.add.arc(
      SPRITE_SIZE / 2 - 4,
      -(SPRITE_SIZE / 2 - 4),
      5,
      0, 360,
      false,
      HEARTBEAT_COLORS.healthy,
      1,
    );

    // Energy-depleted label — Req 11.7
    const energyLabel = this.scene.add.text(0, SPRITE_SIZE / 2 + 4, '精力耗尽', {
      fontSize: '10px',
      color: '#ff5252',
      stroke: '#000000',
      strokeThickness: 2,
      fontFamily: 'Arial, sans-serif',
    }).setOrigin(0.5, 0).setVisible(contestant.energy === 0);

    // Container groups all elements and is positioned at world coords
    const container = this.scene.add.container(x, y, [
      image,
      nameLabel,
      statusDot,
      heartbeatDot,
      energyLabel,
    ]);

    // Make interactive for click → open AttributePanel — Req 6.9
    image.setInteractive({ useHandCursor: true });
    image.on('pointerdown', () => {
      useUiStore.getState().selectContestant(contestant.id);
    });

    this.spriteLayer.add(container);

    const group: SpriteGroup = {
      container,
      image,
      nameLabel,
      statusDot,
      heartbeatDot,
      energyLabel,
      healthStatus: 'healthy',
      tween: null,
    };

    this.sprites.set(contestant.id, group);
    this.applyStatusStyle(group, contestant.status);
  }

  /** Update an existing contestant sprite (position, status, energy). */
  updateContestant(contestant: Contestant): void {
    const group = this.sprites.get(contestant.id);
    if (!group) {
      this.addContestant(contestant);
      return;
    }

    // Update name label
    group.nameLabel.setText(contestant.name);

    // Update status dot color — Req 1.8
    group.statusDot.setFillStyle(STATUS_DOT_COLORS[contestant.status] ?? 0x9e9e9e);

    // Update energy label visibility — Req 11.7
    group.energyLabel.setVisible(contestant.energy === 0);

    // Apply timeout/normal style — Req 9.7
    this.applyStatusStyle(group, contestant.status);

    // Animate to new position — Req 6.4
    const { x, y } = contestant.position;
    const currentX = group.container.x;
    const currentY = group.container.y;

    if (currentX !== x || currentY !== y) {
      this.tweenTo(group, x, y);
    }
  }

  /** Remove a contestant sprite. */
  removeContestant(id: string): void {
    const group = this.sprites.get(id);
    if (!group) return;

    group.tween?.stop();
    group.container.destroy();
    this.sprites.delete(id);
  }

  /** Update heartbeat health status color — Req 9.11 */
  updateHeartbeatStatus(id: string, healthStatus: HealthStatus): void {
    const group = this.sprites.get(id);
    if (!group) return;

    group.healthStatus = healthStatus;
    group.heartbeatDot.setFillStyle(HEARTBEAT_COLORS[healthStatus]);

    // Timeout → gray semi-transparent — Req 9.7
    if (healthStatus === 'timeout') {
      group.container.setAlpha(TIMEOUT_ALPHA);
      group.image.setTint(0xaaaaaa);
    } else if (healthStatus === 'offline') {
      group.container.setAlpha(TIMEOUT_ALPHA);
      group.image.setTint(0x888888);
    } else {
      group.container.setAlpha(NORMAL_ALPHA);
      group.image.clearTint();
    }
  }

  /** Destroy all sprites and unsubscribe from store. */
  destroy(): void {
    this.unsubscribeStore?.();
    this.sprites.forEach((group) => {
      group.tween?.stop();
      group.container.destroy();
    });
    this.sprites.clear();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Apply visual style based on connection status.
   * Timeout → gray semi-transparent (Req 9.7).
   */
  private applyStatusStyle(group: SpriteGroup, status: Contestant['status']): void {
    if (status === 'timeout') {
      group.container.setAlpha(TIMEOUT_ALPHA);
      group.image.setTint(0xaaaaaa);
    } else if (status === 'offline') {
      group.container.setAlpha(TIMEOUT_ALPHA);
      group.image.setTint(0x888888);
    } else {
      // Only restore if heartbeat isn't already forcing timeout style
      if (group.healthStatus !== 'timeout' && group.healthStatus !== 'offline') {
        group.container.setAlpha(NORMAL_ALPHA);
        group.image.clearTint();
      }
    }
  }

  /**
   * Tween container to (x, y) with duration proportional to distance.
   * Duration clamped to [300ms, 1000ms] — Req 6.4.
   */
  private tweenTo(group: SpriteGroup, x: number, y: number): void {
    // Stop any in-progress tween
    group.tween?.stop();

    const dx = x - group.container.x;
    const dy = y - group.container.y;
    const dist = Math.sqrt(dx * dx + dy * dy);

    // Scale duration: 1px ≈ 1ms, clamped to [300, 1000]
    const duration = Phaser.Math.Clamp(dist, TWEEN_MIN_MS, TWEEN_MAX_MS);

    group.tween = this.scene.tweens.add({
      targets: group.container,
      x,
      y,
      duration,
      ease: 'Sine.easeInOut',
      onComplete: () => {
        group.tween = null;
      },
    });
  }

  // ── Store subscription ──────────────────────────────────────────────────────

  /**
   * Subscribe to gameStore to automatically sync contestant changes.
   * Handles add / update / remove.
   */
  private subscribeToStore(): void {
    // Sync current state immediately
    const currentState = useGameStore.getState();
    currentState.contestants.forEach((c) => this.addContestant(c));

    this.unsubscribeStore = useGameStore.subscribe((state, prev) => {
      const current = state.contestants;
      const previous = prev.contestants;

      // Added or updated
      current.forEach((contestant, id) => {
        if (!previous.has(id)) {
          // New contestant
          this.addContestant(contestant);
        } else if (contestant !== previous.get(id)) {
          // Changed contestant
          this.updateContestant(contestant);
        }
      });

      // Removed
      previous.forEach((_c, id) => {
        if (!current.has(id)) {
          this.removeContestant(id);
        }
      });
    });
  }
}
