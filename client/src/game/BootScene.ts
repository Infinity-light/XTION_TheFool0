/**
 * BootScene — Phaser 3 preload scene
 * Loads background image, sprite assets, and zone type icons before starting GameScene.
 * Requirements: 6.1
 */

import Phaser from 'phaser';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Create a simple loading bar
    const { width, height } = this.scale;
    const bar = this.add.graphics();
    const bg = this.add.graphics();

    bg.fillStyle(0x222222);
    bg.fillRect(width / 2 - 160, height / 2 - 15, 320, 30);

    this.load.on('progress', (value: number) => {
      bar.clear();
      bar.fillStyle(0x4caf50);
      bar.fillRect(width / 2 - 158, height / 2 - 13, 316 * value, 26);
    });

    // Zone type icons — generated as colored circles if no external assets
    this.createZoneTypeTextures();

    // Contestant sprite placeholder
    this.createContestantTexture();

    // Background placeholder (will be replaced by actual image if configured)
    this.createMapBackgroundTexture();
  }

  create(): void {
    this.scene.start('GameScene');
  }

  private createZoneTypeTextures(): void {
    // rest zone icon — blue circle
    const restGfx = this.make.graphics({ x: 0, y: 0 }, false);
    restGfx.fillStyle(0x2196f3);
    restGfx.fillCircle(16, 16, 14);
    restGfx.fillStyle(0xffffff);
    restGfx.fillRect(10, 12, 12, 3);  // zzz symbol
    restGfx.generateTexture('icon_rest', 32, 32);
    restGfx.destroy();

    // work zone icon — orange gear-like square
    const workGfx = this.make.graphics({ x: 0, y: 0 }, false);
    workGfx.fillStyle(0xff9800);
    workGfx.fillCircle(16, 16, 14);
    workGfx.fillStyle(0xffffff);
    workGfx.fillRect(10, 10, 12, 12);
    workGfx.generateTexture('icon_work', 32, 32);
    workGfx.destroy();

    // social zone icon — green chat bubble
    const socialGfx = this.make.graphics({ x: 0, y: 0 }, false);
    socialGfx.fillStyle(0x4caf50);
    socialGfx.fillCircle(16, 16, 14);
    socialGfx.fillStyle(0xffffff);
    socialGfx.fillCircle(16, 14, 7);
    socialGfx.generateTexture('icon_social', 32, 32);
    socialGfx.destroy();

    // default/custom zone icon
    const defaultGfx = this.make.graphics({ x: 0, y: 0 }, false);
    defaultGfx.fillStyle(0x9e9e9e);
    defaultGfx.fillCircle(16, 16, 14);
    defaultGfx.generateTexture('icon_default', 32, 32);
    defaultGfx.destroy();
  }

  private createContestantTexture(): void {
    const gfx = this.make.graphics({ x: 0, y: 0 }, false);
    // Body
    gfx.fillStyle(0x1565c0);
    gfx.fillCircle(20, 20, 16);
    // Head
    gfx.fillStyle(0xffcc80);
    gfx.fillCircle(20, 10, 8);
    gfx.generateTexture('contestant', 40, 40);
    gfx.destroy();
  }

  private createMapBackgroundTexture(): void {
    const gfx = this.make.graphics({ x: 0, y: 0 }, false);
    gfx.fillStyle(0x1a1a2e);
    gfx.fillRect(0, 0, 1600, 900);
    // Grid lines
    gfx.lineStyle(1, 0x2a2a4e, 0.5);
    for (let x = 0; x <= 1600; x += 100) {
      gfx.lineBetween(x, 0, x, 900);
    }
    for (let y = 0; y <= 900; y += 100) {
      gfx.lineBetween(0, y, 1600, y);
    }
    gfx.generateTexture('map_bg', 1600, 900);
    gfx.destroy();
  }
}
