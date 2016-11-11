// @flow
'use strict';
export default class VirtualClock {
    _now: Function;
    _previousTime: number;
    _previousNow: number;
    _rate: number;
    _running: boolean;
    _minimum: number;
    _maximum: number;
    _loop: boolean;
    _eventListeners: Map<string, Function[]>;
    _timeListeners: Map<[number, Function], [number, number, boolean]>;
    
    /**
     * Constructs a stopped clock with default settings.
     */
    constructor() {
        // Determine method for retrieving now
        this._now =
            (typeof performance !== 'undefined' && /*global performance */ performance.now) ||
            (typeof process !== 'undefined' && /*global process */ process.hrtime && (() => { let now = process.hrtime(); return now[0] * 1e3 + now[1] / 1e6; })) ||
            Date.now ||
            (() => { return new Date().getTime(); });
        
        // Current state
        this._previousTime = 0;
        this._previousNow = this._now();

        // Flow of time configuration
        this._rate = 1.0;
        this._running = false;

        // Minimum / maximum / looping configuration
        this._minimum = -Infinity;
        this._maximum = Infinity;
        this._loop = false;

        // Event and time listeners
        this._eventListeners = new Map();
        this._timeListeners = new Map();
        
        // Make private properties non-enumerable
        for(let prop in this) {
            if(prop.startsWith('_')) {
                Object.defineProperty(this, prop, { enumerable: false });
            }
        }
    }

    // Methods
    /**
     * Starts running the clock. Does nothing when clock was already running.
     */
    start(): VirtualClock {
        // Start running the time if we werent running
        if(!this._running) {
            this._previousNow = this._now();
            this._running = true;
            this._recalculateTimeListeners();

            // Trigger event listeners
            this.trigger('start');
        }

        // Trigger setrunning listeners
        this.trigger('setrunning');

        // Method chaining
        return this;
    }

    /**
     * Stops running the clock. Does nothing when clock was not running.
     */
    stop(): VirtualClock {
        // Stops running the time if we were running
        if(this._running) {
            this._previousTime = this.time;
            this._running = false;
            this._recalculateTimeListeners();

            // Trigger event listeners
            this.trigger('stop');
        }

        // Trigger setrunning listeners
        this.trigger('setrunning');

        // Method chaining
        return this;
    }

    /**
     * Attaches an event listener.
     *
     * Supported events: start, stop, settime, setrunning, setrate, setminimum, setmaximum, setloop
     */
    on(event: string, callback: Function): VirtualClock {
        // Add the listener
        let listeners = this._eventListeners.get(event);
        if(listeners) {
            listeners.push(callback);
        } else {
            this._eventListeners.set(event, [callback]);
        }

        // Method chaining
        return this;
    }

    /**
     * Detaches a previously attached event listener.
     */
    off(event: string, callback: Function): VirtualClock {
        // Find the listener
        let listeners = this._eventListeners.get(event);
        if(listeners) {
            let i = listeners.indexOf(callback);
            if(i >= 0) {
                // Remove the listener
                listeners.splice(i, 1);

                // Method chaining
                return this;
            }
        }

        // When not found, throw an error
        throw new Error('Event listener not found');
    }

    /**
     * Triggers an attached event listener.
     */
    trigger(event: string, ...args: mixed[]): VirtualClock {
        let listeners = this._eventListeners.get(event);
        if(listeners) {
            listeners.slice(0).forEach((listener) => {
                listener.apply(this, args);
            });
        }

        // Method chaining
        return this;
    }

    /**
     * Private method for recalculating all registered time listeners.
     */
    _recalculateTimeListeners() {
        for(let listener of this._timeListeners.keys()) {
            this._recalculateTimeListener(listener);
        }
    }

    /**
     * Private method for recalculating a specific registered time listener.
     */
    _recalculateTimeListener(listener: [number, Function]) {
        // Check if the listener is still registered
        let listenerData = this._timeListeners.get(listener);
        if(listenerData) {
            let [time, callback] = listener;
            let [timeoutId, lastCalled, once] = listenerData;

            // Clear any open timeouts
            clearTimeout(timeoutId);

            // Only add timeouts if we're running and the time is reachable
            if(this._running && this._rate != 0 && time >= this._minimum && time <= this._maximum) {
                // Get current time
                let currentTime = this.time;

                // Did we already run at this time?
                if(currentTime === lastCalled) {
                    // Is is possible to wait?
                    if(this._loop || currentTime !== this._minimum && currentTime !== this._maximum) {
                        // Wait until the time has changed enough to prevent racing and then retry
                        this._timeListeners.set(listener, [setTimeout(() => {
                            this._recalculateTimeListener(listener);
                        }, 1), lastCalled, once]);
                    }
                } else {
                    // Clock time until the listener should be triggered
                    let until;

                    // Initial calculation depends on which way time is moving
                    if(this._rate > 0) {
                        until = time - currentTime;
                    } else {
                        until = currentTime - time;
                    }

                    // If the time is going to be reached
                    if(until >= 0 || this._loop && this._minimum > -Infinity && this._maximum < Infinity) {
                        // Add time when looping
                        if(until < 0) {
                            until += (this._maximum - this._minimum);
                        }

                        // Factor in the rate
                        until *= 1 / Math.abs(this._rate);

                        // Ceil the value, otherwise setTimeout may floor it and run before it is supposed to
                        until = Math.ceil(until);

                        // Set timeout
                        this._timeListeners.set(listener, [setTimeout(() => {
                            // Safety checkif listener is still registered
                            let listenerData = this._timeListeners.get(listener);
                            if(listenerData) {
                                // Re-acquire once
                                let [, , once] = listenerData;

                                // Save time of call
                                this._timeListeners.set(listener, [0, this.time, once]);

                                // Call the callback
                                callback.call(this);

                                // Should we self-destruct
                                if(once) {
                                    this._timeListeners.delete(listener);
                                } else {
                                    // Recalculate the time listener
                                    this._recalculateTimeListener(listener);
                                }
                            }
                        }, until), NaN, once]);
                    }
                }
            }
        }
    }

    /**
     * Attaches a time listener which fires once after the specified clock time has passed.
     */
    onceAt(time: number, callback: Function): VirtualClock {
        let listener = [time, callback];
        this._timeListeners.set(listener, [0, NaN, true]);
        this._recalculateTimeListener(listener);
        
        // Method chaining
        return this;
    }
    
    /**
     * Attaches a time listener which fires every time the specified clock time has passed.
     */
    alwaysAt(time: number, callback: Function): VirtualClock {
        let listener = [time, callback];
        this._timeListeners.set(listener, [0, NaN, false]);
        this._recalculateTimeListener(listener);
        
        // Method chaining
        return this;
    }
    
    /**
     * Detaches a previously attached time listener.
     */
    removeAt(time: number, callback: Function): VirtualClock {
        // Loop over all listeners
        for(let listener of this._timeListeners.keys()) {
            let [listenerTime, listenerCallback] = listener;
            
            // If the listener matches, delete it
            if(listenerTime === time && listenerCallback === callback) {
                this._timeListeners.delete(listener);
            }
        }
        
        // Method chaining
        return this;
    }

    // Getters
    /**
     * The current clock time.
     */
    get time(): number {
        let currentTime = this._previousTime;

        // If running, the time is has changed since the previous time so we recalculate it
        if(this._running) {
            // Calculate current time based on passed time
            currentTime += this._rate * (this._now() - this._previousNow);
        }

        // Can we loop (loop enabled + a non-zero non-finite maximum)
        if(this._loop && this._minimum > -Infinity && this._maximum < Infinity) {
            // Is the time below the minimum (meaning we are looping backwards)
            if(currentTime < this._minimum) {
                // Append until we're between bounds again
                do {
                    currentTime += (this._maximum - this._minimum);
                } while(currentTime < this._minimum);
            } else {
                // Performance: If the minimum is zero, just calculate our current position in the loop by modulo
                if(this._minimum == 0) {
                    currentTime %= this._maximum;
                } else {
                    // Substract until we're between bounds again
                    while(currentTime >= this._maximum) {
                        currentTime -= (this._maximum - this._minimum);
                    }
                }
            }
        } else {
            // No looping means we just limit our output between minimum and maximum
            currentTime = Math.min(Math.max(this._minimum, currentTime), this._maximum);
        }

        return currentTime;
    }

    /**
     * Whether the clock is currently running.
     */
    get running(): boolean {
        return this._running;
    }

    /**
     * The current rate (relative to real time) the clock runs at.
     */
    get rate(): number {
        return this._rate;
    }

    /**
     * The minimum limit for time on the clock.
     */
    get minimum(): number {
        return this._minimum;
    }

    /**
     * The maximum limit for time on the clock.
     */
    get maximum(): number {
        return this._maximum;
    }

    /**
     * Whether the clock will loop around after reaching the maximum.
     */
    get loop(): boolean {
        return this._loop;
    }

    // Setters
    /**
     * Sets the current clock time.
     */
    set time(time: number) {
        // Recalibrate by setting both correct time and now
        this._previousTime = Math.min(Math.max(this._minimum, time), this._maximum);
        this._previousNow = this._now();

        // Recalculate time listeners
        this._recalculateTimeListeners();

        // Trigger event listeners
        this.trigger('settime');
    }
    
    /**
     * Starts or stops running the clock.
     */
    set running(running: boolean) {
        // Changing running state just calls start() or stop()
        running ? this.start() : this.stop();
    }
    
    /**
     * Sets the rate (relative to real time) at which the clock runs.
     */
    set rate(rate: number) {
        // Recalibration is only needed when we're running
        if(this._running) {
            this._previousTime = this.time;
            this._previousNow = this._now();
        }

        // Set rate
        this._rate = rate;

        // Recalculate time listeners
        this._recalculateTimeListeners();

        // Trigger event listeners
        this.trigger('setrate');
    }
    
    /**
     * Sets minimum limit for time on the clock.
     */
    set minimum(minimum: number) {
        // First get the calculated time, calculated using the old minimum
        let previousTime = this.time;
        
        // Do not allow setting a minimum above the maximum
        if(minimum > this._maximum || minimum == Infinity) {
            throw new Error('Cannot set minimum above maximum');
        }

        // Change the minimum
        this._minimum = minimum;

        // Recalibrate the time using the previous value and the new minimum
        this._previousTime = Math.min(Math.max(this._minimum, previousTime), this._maximum);
        this._previousNow = this._now();

        // Recalculate time listeners
        this._recalculateTimeListeners();

        // Trigger event listeners
        this.trigger('setminimum');
    }
    
    /**
     * Sets maximum limit for time on the clock.
     */
    set maximum(maximum: number) {
        // First get the calculated time, calculated using the old maximum
        let previousTime = this.time;
        
        // Do not allow setting a maximum below the minimum
        if(maximum < this._minimum || maximum == -Infinity) {
            throw new Error('Cannot set maximum below minimum');
        }

        // Change the maximum
        this._maximum = maximum;

        // Recalibrate the time using the previous value and the new maximum
        this._previousTime = Math.min(Math.max(this._minimum, previousTime), this._maximum);
        this._previousNow = this._now();

        // Recalculate time listeners
        this._recalculateTimeListeners();

        // Trigger event listeners
        this.trigger('setmaximum');
    }

    /**
     * Sets whether the clock loops around after reaching the maximum.
     */
    set loop(loop: boolean) {
        // Recalibrate
        this._previousTime = this.time;
        this._previousNow = this._now();

        // Set looping
        this._loop = loop;

        // Recalculate time listeners
        this._recalculateTimeListeners();

        // Trigger event listeners
        this.trigger('setloop');
    }
}