/**
 * RotaryKnob — a rotary control that works the same way with a mouse and
 * with a finger: press and drag in a circle around the knob (the angle you
 * sweep maps to steps/value, like turning the real encoder/pot), or use a
 * wheel/trackpad scroll while hovering. Pointer Events give us one code
 * path for mouse, touch and pen.
 *
 * Two modes:
 *  - continuous (the big channel selector): an unbounded detented encoder.
 *    Fires onStep(direction) for each detent crossed; the visual indicator
 *    spins freely.
 *  - bounded (VOL/SQL): a pot with a fixed sweep (minAngle..maxAngle)
 *    mapped to a value range. Fires onChange(value); the knob tracks the
 *    pointer's absolute angle, like a circular slider.
 */
(function (global) {
  "use strict";

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  // Shortest signed distance from a to b, in degrees, both in [-180,180].
  function angleDelta(a, b) {
    let d = b - a;
    while (d > 180) d -= 360;
    while (d < -180) d += 360;
    return d;
  }

  class RotaryKnob {
    constructor(el, opts) {
      this.el = el;
      this.opts = Object.assign(
        {
          continuous: true,
          degreesPerStep: 18,
          minValue: 0,
          maxValue: 100,
          value: 50,
          minAngle: -135,
          maxAngle: 135,
          label: "Knob",
          onStep: null,
          onChange: null,
        },
        opts
      );

      this.visualAngle = this.opts.continuous
        ? 0
        : this._valueToAngle(this.opts.value);
      this.value = this.opts.value;
      this._stepAccumulator = 0;
      this._dragging = false;
      this._lastPointerAngle = 0;

      this.indicator =
        el.querySelector(".knob__indicator") || el;

      el.classList.add("knob");
      el.setAttribute("role", this.opts.continuous ? "button" : "slider");
      el.setAttribute("tabindex", "0");
      el.setAttribute("aria-label", this.opts.label);
      if (!this.opts.continuous) {
        el.setAttribute("aria-valuemin", this.opts.minValue);
        el.setAttribute("aria-valuemax", this.opts.maxValue);
        el.setAttribute("aria-valuenow", this.value);
      }

      this._onPointerDown = this._onPointerDown.bind(this);
      this._onPointerMove = this._onPointerMove.bind(this);
      this._onPointerUp = this._onPointerUp.bind(this);
      this._onWheel = this._onWheel.bind(this);
      this._onKeyDown = this._onKeyDown.bind(this);

      el.addEventListener("pointerdown", this._onPointerDown);
      el.addEventListener("wheel", this._onWheel, { passive: false });
      el.addEventListener("keydown", this._onKeyDown);

      this._render();
    }

    setValue(v) {
      this.value = clamp(v, this.opts.minValue, this.opts.maxValue);
      this.visualAngle = this._valueToAngle(this.value);
      this.el.setAttribute("aria-valuenow", Math.round(this.value));
      this._render();
    }

    _valueToAngle(v) {
      const { minValue, maxValue, minAngle, maxAngle } = this.opts;
      const t = (v - minValue) / (maxValue - minValue);
      return minAngle + t * (maxAngle - minAngle);
    }

    _angleToValue(angle) {
      const { minValue, maxValue, minAngle, maxAngle } = this.opts;
      const t = (angle - minAngle) / (maxAngle - minAngle);
      return minValue + clamp(t, 0, 1) * (maxValue - minValue);
    }

    // Returns null inside a small dead zone around the pivot: atan2 is
    // numerically unstable there (a sub-pixel jitter can swing the angle by
    // up to 180deg), which would otherwise cause a spurious jump whenever a
    // drag starts near the knob's center.
    _pointerAngle(evt) {
      const rect = this.el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = evt.clientX - cx;
      const dy = evt.clientY - cy;
      if (Math.hypot(dx, dy) < 6) return null;
      // 0deg = up, +90 = right, matches a clock face.
      return Math.atan2(dx, -dy) * (180 / Math.PI);
    }

    _onPointerDown(evt) {
      evt.preventDefault();
      this._dragging = true;
      this.el.setPointerCapture(evt.pointerId);
      const angle = this._pointerAngle(evt);
      this._havePointerAngle = angle !== null;
      this._lastPointerAngle = angle === null ? 0 : angle;
      if (!this.opts.continuous && angle !== null) {
        const clamped = clamp(angle, this.opts.minAngle, this.opts.maxAngle);
        this.setValue(this._angleToValue(clamped));
        if (this.opts.onChange) this.opts.onChange(this.value);
      }
      this.el.addEventListener("pointermove", this._onPointerMove);
      this.el.addEventListener("pointerup", this._onPointerUp);
      this.el.addEventListener("pointercancel", this._onPointerUp);
      this.el.classList.add("knob--active");
    }

    _onPointerMove(evt) {
      if (!this._dragging) return;
      const angle = this._pointerAngle(evt);
      if (angle === null) return; // still inside the dead zone, wait it out
      if (!this._havePointerAngle) {
        // First stable sample after starting the drag in the dead zone:
        // establish the baseline without firing a spurious delta.
        this._lastPointerAngle = angle;
        this._havePointerAngle = true;
        if (!this.opts.continuous) {
          const clamped = clamp(angle, this.opts.minAngle, this.opts.maxAngle);
          this.setValue(this._angleToValue(clamped));
          if (this.opts.onChange) this.opts.onChange(this.value);
        }
        return;
      }

      if (this.opts.continuous) {
        const delta = angleDelta(this._lastPointerAngle, angle);
        this.visualAngle += delta;
        this._stepAccumulator += delta;
        const step = this.opts.degreesPerStep;
        while (this._stepAccumulator >= step) {
          this._stepAccumulator -= step;
          if (this.opts.onStep) this.opts.onStep(1);
        }
        while (this._stepAccumulator <= -step) {
          this._stepAccumulator += step;
          if (this.opts.onStep) this.opts.onStep(-1);
        }
        this._render();
      } else {
        const clamped = clamp(angle, this.opts.minAngle, this.opts.maxAngle);
        this.setValue(this._angleToValue(clamped));
        if (this.opts.onChange) this.opts.onChange(this.value);
      }
      this._lastPointerAngle = angle;
    }

    _onPointerUp(evt) {
      this._dragging = false;
      try {
        this.el.releasePointerCapture(evt.pointerId);
      } catch (e) {
        /* already released */
      }
      this.el.removeEventListener("pointermove", this._onPointerMove);
      this.el.removeEventListener("pointerup", this._onPointerUp);
      this.el.removeEventListener("pointercancel", this._onPointerUp);
      this.el.classList.remove("knob--active");
    }

    _onWheel(evt) {
      evt.preventDefault();
      const dir = evt.deltaY < 0 ? 1 : -1;
      if (this.opts.continuous) {
        this.visualAngle += dir * this.opts.degreesPerStep;
        this._render();
        if (this.opts.onStep) this.opts.onStep(dir);
      } else {
        const span = this.opts.maxValue - this.opts.minValue;
        this.setValue(this.value + dir * span * 0.04);
        if (this.opts.onChange) this.opts.onChange(this.value);
      }
    }

    _onKeyDown(evt) {
      let dir = 0;
      if (evt.key === "ArrowUp" || evt.key === "ArrowRight") dir = 1;
      else if (evt.key === "ArrowDown" || evt.key === "ArrowLeft") dir = -1;
      else if (evt.key === "Home" && !this.opts.continuous) {
        evt.preventDefault();
        this.setValue(this.opts.minValue);
        if (this.opts.onChange) this.opts.onChange(this.value);
        return;
      } else if (evt.key === "End" && !this.opts.continuous) {
        evt.preventDefault();
        this.setValue(this.opts.maxValue);
        if (this.opts.onChange) this.opts.onChange(this.value);
        return;
      }
      if (!dir) return;
      evt.preventDefault();
      if (this.opts.continuous) {
        this.visualAngle += dir * this.opts.degreesPerStep;
        this._render();
        if (this.opts.onStep) this.opts.onStep(dir);
      } else {
        const span = this.opts.maxValue - this.opts.minValue;
        this.setValue(this.value + dir * span * 0.04);
        if (this.opts.onChange) this.opts.onChange(this.value);
      }
    }

    _render() {
      this.indicator.style.transform = `rotate(${this.visualAngle}deg)`;
    }
  }

  global.RotaryKnob = RotaryKnob;
})(window);
