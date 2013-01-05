// TEXT TRACKS
// Text tracks are tracks of timed text events.
//    Captions - text displayed over the video for the hearing impared
//    Subtitles - text displayed over the video for those who don't understand langauge in the video
//    Chapters - text displayed in a menu allowing the user to jump to particular points (chapters) in the video
//    Descriptions (not supported yet) - audio descriptions that are read back to the user by a screen reading device

// Player Track Functions - Functions add to the player object for easier access to tracks

// Add an array of text tracks. captions, subtitles, chapters, descriptions
// Track objects will be stored in the player.textTracks array
vjs.Player.prototype.addTextTracks = function(trackObjects){
  var track, Kind,
      tracks = this.textTracks = this.textTracks || [],
      i = 0,
      j = trackObjects.length;

  for (;i<j;i++) {
    // HTML5 Spec says default to subtitles.
    // Uppercase (uc) first letter to match class names
    Kind = vjs.capitalize(trackObjects[i].kind || "subtitles");

    // Create correct texttrack class. CaptionsTrack, etc.
    track = new window['videojs'][Kind + "Track"](this, trackObjects[i]);

    tracks.push(track);

    // If track.default is set, start showing immediately
    // TODO: Add a process to deterime the best track to show for the specific kind
    // Incase there are mulitple defaulted tracks of the same kind
    // Or the user has a set preference of a specific language that should override the default
    if (track['default']) {
      this.ready(vjs.bind(track, track.show));
    }
  }

  // Return the track so it can be appended to the display component
  return this;
};

// Show a text track
// disableSameKind: disable all other tracks of the same kind. Value should be a track kind (captions, etc.)
vjs.Player.prototype.showTextTrack = function(id, disableSameKind){
  var tracks = this.textTracks,
      i = 0,
      j = tracks.length,
      track, showTrack, kind;

  // Find Track with same ID
  for (;i<j;i++) {
    track = tracks[i];
    if (track.id === id) {
      track.show();
      showTrack = track;

    // Disable tracks of the same kind
    } else if (disableSameKind && track.kind == disableSameKind && track.mode > 0) {
      track.disable();
    }
  }

  // Get track kind from shown track or disableSameKind
  kind = (showTrack) ? showTrack.kind : ((disableSameKind) ? disableSameKind : false);

  // Trigger trackchange event, captionstrackchange, subtitlestrackchange, etc.
  if (kind) {
    this.trigger(kind+"trackchange");
  }

  return this;
};

/**
 * Track Class
 * Contains track methods for loading, showing, parsing cues of tracks
 * @param {vjs.Player|Object} player
 * @param {Object=} options
 * @constructor
 */
vjs.Track = function(player, options){
  goog.base(this, player, options);

  // Apply track info to track object
  // Options will often be a track element
  vjs.merge(this, {
    // Build ID if one doesn't exist
    id: options.id || ("vjs_" + options.kind + "_" + options.language + "_" + vjs.guid++),

    src: options.src,

    // If default is used, subtitles/captions to start showing
    "default": options["default"], // 'default' is reserved-ish
    title: options.title,

    // Language - two letter string to represent track language, e.g. "en" for English
    // readonly attribute DOMString language;
    language: options.srclang,

    // Track label e.g. "English"
    // readonly attribute DOMString label;
    label: options.label,

    // All cues of the track. Cues have a startTime, endTime, text, and other properties.
    // readonly attribute TextTrackCueList cues;
    cues: [],

    // ActiveCues is all cues that are currently showing
    // readonly attribute TextTrackCueList activeCues;
    activeCues: [],

    // ReadyState describes if the text file has been loaded
    // const unsigned short NONE = 0;
    // const unsigned short LOADING = 1;
    // const unsigned short LOADED = 2;
    // const unsigned short ERROR = 3;
    // readonly attribute unsigned short readyState;
    readyState: 0,

    // Mode describes if the track is showing, hidden, or disabled
    // const unsigned short OFF = 0;
    // const unsigned short HIDDEN = 1; (still triggering cuechange events, but not visible)
    // const unsigned short SHOWING = 2;
    // attribute unsigned short mode;
    mode: 0
  });
};
goog.inherits(vjs.Track, vjs.Component);

  // Create basic div to hold cue text
vjs.Track.prototype.createEl = function(){
  return goog.base(this, 'createEl', "div", {
    className: "vjs-" + this.kind + " vjs-text-track"
  });
};

// Show: Mode Showing (2)
// Indicates that the text track is active. If no attempt has yet been made to obtain the track's cues, the user agent will perform such an attempt momentarily.
// The user agent is maintaining a list of which cues are active, and events are being fired accordingly.
// In addition, for text tracks whose kind is subtitles or captions, the cues are being displayed over the video as appropriate;
// for text tracks whose kind is descriptions, the user agent is making the cues available to the user in a non-visual fashion;
// and for text tracks whose kind is chapters, the user agent is making available to the user a mechanism by which the user can navigate to any point in the media resource by selecting a cue.
// The showing by default state is used in conjunction with the default attribute on track elements to indicate that the text track was enabled due to that attribute.
// This allows the user agent to override the state if a later track is discovered that is more appropriate per the user's preferences.
vjs.Track.prototype.show = function(){
  this.activate();

  this.mode = 2;

  // Show element.
  goog.base(this, 'show');
};

// Hide: Mode Hidden (1)
// Indicates that the text track is active, but that the user agent is not actively displaying the cues.
// If no attempt has yet been made to obtain the track's cues, the user agent will perform such an attempt momentarily.
// The user agent is maintaining a list of which cues are active, and events are being fired accordingly.
vjs.Track.prototype.hide = function(){
  // When hidden, cues are still triggered. Disable to stop triggering.
  this.activate();

  this.mode = 1;

  // Hide element.
  goog.base(this, 'hide');
};

// Disable: Mode Off/Disable (0)
// Indicates that the text track is not active. Other than for the purposes of exposing the track in the DOM, the user agent is ignoring the text track.
// No cues are active, no events are fired, and the user agent will not attempt to obtain the track's cues.
vjs.Track.prototype.disable = function(){
  // If showing, hide.
  if (this.mode == 2) { this.hide(); }

  // Stop triggering cues
  this.deactivate();

  // Switch Mode to Off
  this.mode = 0;
};

// Turn on cue tracking. Tracks that are showing OR hidden are active.
vjs.Track.prototype.activate = function(){
  // Load text file if it hasn't been yet.
  if (this.readyState == 0) { this.load(); }

  // Only activate if not already active.
  if (this.mode == 0) {
    // Update current cue on timeupdate
    // Using unique ID for bind function so other tracks don't remove listener
    this.player.on("timeupdate", vjs.bind(this, this.update, this.id));

    // Reset cue time on media end
    this.player.on("ended", vjs.bind(this, this.reset, this.id));

    // Add to display
    if (this.kind == "captions" || this.kind == "subtitles") {

      console.log('adsf', this.player.childNameIndex_);

      this.player.textTrackDisplay.addChild(this);
    }
  }
};

// Turn off cue tracking.
vjs.Track.prototype.deactivate = function(){
  // Using unique ID for bind function so other tracks don't remove listener
  this.player.off("timeupdate", vjs.bind(this, this.update, this.id));
  this.player.off("ended", vjs.bind(this, this.reset, this.id));
  this.reset(); // Reset

  // Remove from display
  this.player.textTrackDisplay.removeChild(this);
};

// A readiness state
// One of the following:
//
// Not loaded
// Indicates that the text track is known to exist (e.g. it has been declared with a track element), but its cues have not been obtained.
//
// Loading
// Indicates that the text track is loading and there have been no fatal errors encountered so far. Further cues might still be added to the track.
//
// Loaded
// Indicates that the text track has been loaded with no fatal errors. No new cues will be added to the track except if the text track corresponds to a MutableTextTrack object.
//
// Failed to load
// Indicates that the text track was enabled, but when the user agent attempted to obtain it, this failed in some way (e.g. URL could not be resolved, network error, unknown text track format). Some or all of the cues are likely missing and will not be obtained.
vjs.Track.prototype.load = function(){

  // Only load if not loaded yet.
  if (this.readyState == 0) {
    this.readyState = 1;
    console.log('track get method not supported yet')
    // vjs.get(this.src, vjs.bind(this, this.parseCues), vjs.bind(this, this.onError));
  }

};

vjs.Track.prototype.onError = function(err){
  this.error = err;
  this.readyState = 3;
  this.trigger("error");
};

// Parse the WebVTT text format for cue times.
// TODO: Separate parser into own class so alternative timed text formats can be used. (TTML, DFXP)
vjs.Track.prototype.parseCues = function(srcContent) {
  var cue, time, text,
      lines = srcContent.split("\n"),
      line = "", id;

  for (var i=1, j=lines.length; i<j; i++) {
    // Line 0 should be 'WEBVTT', so skipping i=0

    line = vjs.trim(lines[i]); // Trim whitespace and linebreaks

    if (line) { // Loop until a line with content

      // First line could be an optional cue ID
      // Check if line has the time separator
      if (line.indexOf("-->") == -1) {
        id = line;
        // Advance to next line for timing.
        line = vjs.trim(lines[++i]);
      } else {
        id = this.cues.length;
      }

      // First line - Number
      cue = {
        id: id, // Cue Number
        index: this.cues.length // Position in Array
      };

      // Timing line
      time = line.split(" --> ");
      cue.startTime = this.parseCueTime(time[0]);
      cue.endTime = this.parseCueTime(time[1]);

      // Additional lines - Cue Text
      text = [];

      // Loop until a blank line or end of lines
      // Assumeing trim("") returns false for blank lines
      while (lines[++i] && (line = vjs.trim(lines[i]))) {
        text.push(line);
      }

      cue.text = text.join('<br/>');

      // Add this cue
      this.cues.push(cue);
    }
  }

  this.readyState = 2;
  this.trigger("loaded");
};


vjs.Track.prototype.parseCueTime = function(timeText) {
  var parts = timeText.split(':'),
      time = 0,
      hours, minutes, other, seconds, ms, flags;

  // Check if optional hours place is included
  // 00:00:00.000 vs. 00:00.000
  if (parts.length == 3) {
    hours = parts[0];
    minutes = parts[1];
    other = parts[2];
  } else {
    hours = 0;
    minutes = parts[0];
    other = parts[1];
  }

  // Break other (seconds, milliseconds, and flags) by spaces
  // TODO: Make additional cue layout settings work with flags
  other = other.split(/\s+/)
  // Remove seconds. Seconds is the first part before any spaces.
  seconds = other.splice(0,1)[0];
  // Could use either . or , for decimal
  seconds = seconds.split(/\.|,/);
  // Get milliseconds
  ms = parseFloat(seconds[1]);
  seconds = seconds[0];

  // hours => seconds
  time += parseFloat(hours) * 3600;
  // minutes => seconds
  time += parseFloat(minutes) * 60;
  // Add seconds
  time += parseFloat(seconds);
  // Add milliseconds
  if (ms) { time += ms/1000; }

  return time;
};

// Update active cues whenever timeupdate events are triggered on the player.
vjs.Track.prototype.update = function(){
  if (this.cues.length > 0) {

    // Get curent player time
    var time = this.player.currentTime();

    // Check if the new time is outside the time box created by the the last update.
    if (this.prevChange === undefined || time < this.prevChange || this.nextChange <= time) {
      var cues = this.cues,

          // Create a new time box for this state.
          newNextChange = this.player.duration(), // Start at beginning of the timeline
          newPrevChange = 0, // Start at end

          reverse = false, // Set the direction of the loop through the cues. Optimized the cue check.
          newCues = [], // Store new active cues.

          // Store where in the loop the current active cues are, to provide a smart starting point for the next loop.
          firstActiveIndex, lastActiveIndex,

          html = "", // Create cue text HTML to add to the display
          cue, i, j; // Loop vars

      // Check if time is going forwards or backwards (scrubbing/rewinding)
      // If we know the direction we can optimize the starting position and direction of the loop through the cues array.
      if (time >= this.nextChange || this.nextChange === undefined) { // NextChange should happen
        // Forwards, so start at the index of the first active cue and loop forward
        i = (this.firstActiveIndex !== undefined) ? this.firstActiveIndex : 0;
      } else {
        // Backwards, so start at the index of the last active cue and loop backward
        reverse = true;
        i = (this.lastActiveIndex !== undefined) ? this.lastActiveIndex : cues.length - 1;
      }

      while (true) { // Loop until broken
        cue = cues[i];

        // Cue ended at this point
        if (cue.endTime <= time) {
          newPrevChange = Math.max(newPrevChange, cue.endTime);

          if (cue.active) {
            cue.active = false;
          }

          // No earlier cues should have an active start time.
          // Nevermind. Assume first cue could have a duration the same as the video.
          // In that case we need to loop all the way back to the beginning.
          // if (reverse && cue.startTime) { break; }

        // Cue hasn't started
        } else if (time < cue.startTime) {
          newNextChange = Math.min(newNextChange, cue.startTime);

          if (cue.active) {
            cue.active = false;
          }

          // No later cues should have an active start time.
          if (!reverse) { break; }

        // Cue is current
        } else {

          if (reverse) {
            // Add cue to front of array to keep in time order
            newCues.splice(0,0,cue);

            // If in reverse, the first current cue is our lastActiveCue
            if (lastActiveIndex === undefined) { lastActiveIndex = i; }
            firstActiveIndex = i;
          } else {
            // Add cue to end of array
            newCues.push(cue);

            // If forward, the first current cue is our firstActiveIndex
            if (firstActiveIndex === undefined) { firstActiveIndex = i; }
            lastActiveIndex = i;
          }

          newNextChange = Math.min(newNextChange, cue.endTime);
          newPrevChange = Math.max(newPrevChange, cue.startTime);

          cue.active = true;
        }

        if (reverse) {
          // Reverse down the array of cues, break if at first
          if (i === 0) { break; } else { i--; }
        } else {
          // Walk up the array fo cues, break if at last
          if (i === cues.length - 1) { break; } else { i++; }
        }

      }

      this.activeCues = newCues;
      this.nextChange = newNextChange;
      this.prevChange = newPrevChange;
      this.firstActiveIndex = firstActiveIndex;
      this.lastActiveIndex = lastActiveIndex;

      this.updateDisplay();

      this.trigger("cuechange");
    }
  }
};

// Add cue HTML to display
vjs.Track.prototype.updateDisplay = function(){
  var cues = this.activeCues,
      html = "",
      i=0,j=cues.length;

  for (;i<j;i++) {
    html += "<span class='vjs-tt-cue'>"+cues[i].text+"</span>";
  }

  this.el_.innerHTML = html;
};

// Set all loop helper values back
vjs.Track.prototype.reset = function(){
  this.nextChange = 0;
  this.prevChange = this.player.duration();
  this.firstActiveIndex = 0;
  this.lastActiveIndex = 0;
};

// Create specific track types
/**
 * @constructor
 */
vjs.CaptionsTrack = function(player, options, ready){
  goog.base(this, player, options, ready);
};
goog.inherits(vjs.CaptionsTrack, vjs.Track);
vjs.CaptionsTrack.prototype.kind = "captions";
// Exporting here because Track creation requires the track kind
// to be available on global object. e.g. new window['videojs'][Kind + 'Track']

/**
 * @constructor
 */
vjs.SubtitlesTrack = function(player, options, ready){
  goog.base(this, player, options, ready);
};
goog.inherits(vjs.SubtitlesTrack, vjs.Track);
vjs.SubtitlesTrack.prototype.kind = "subtitles";

/**
 * @constructor
 */
vjs.ChaptersTrack = function(player, options, ready){
  goog.base(this, player, options, ready);
};
goog.inherits(vjs.ChaptersTrack, vjs.Track);
vjs.ChaptersTrack.prototype.kind = "chapters";


/* Text Track Display
============================================================================= */
// Global container for both subtitle and captions text. Simple div container.

/**
 * @constructor
 */
vjs.TextTrackDisplay = function(player, options, ready){
  goog.base(this, player, options, ready);

  // This used to be called during player init, but was causing an error
  // if a track should show by default and the display hadn't loaded yet.
  // Should probably be moved to an external track loader when we support
  // tracks that don't need a display.
  if (player.options.tracks && player.options.tracks.length > 0) {
    this.player.addTextTracks(options.tracks);
  }
};
goog.inherits(vjs.TextTrackDisplay, vjs.Component);

vjs.TextTrackDisplay.prototype.createEl = function(){
  return goog.base(this, 'createEl', "div", {
    className: "vjs-text-track-display"
  });
};


/* Text Track Menu Items
============================================================================= */
/**
 * @constructor
 */
vjs.TextTrackMenuItem = function(player, options){
  var track = this.track = options.track;

  // Modify options for parent MenuItem class's init.
  options.label = track.label;
  options.selected = track["default"];
  goog.base(this, player, options);

  this.player.on(track.kind + "trackchange", vjs.bind(this, this.update));
};
goog.inherits(vjs.TextTrackMenuItem, vjs.MenuItem);

vjs.TextTrackMenuItem.prototype.onClick = function(){
  goog.base(this, 'onClick');
  this.player.showTextTrack(this.track.id, this.track.kind);
};

vjs.TextTrackMenuItem.prototype.update = function(){
  if (this.track.mode == 2) {
    this.selected(true);
  } else {
    this.selected(false);
  }
};

/**
 * @constructor
 */
vjs.OffTextTrackMenuItem = function(player, options){
  // Create pseudo track info
  // Requires options.kind
  options.track = { kind: options.kind, player: player, label: "Off" }
  goog.base(this, player, options);
};
goog.inherits(vjs.OffTextTrackMenuItem, vjs.TextTrackMenuItem);

vjs.OffTextTrackMenuItem.prototype.onClick = function(){
  goog.base(this, 'onClick');
  this.player.showTextTrack(this.track.id, this.track.kind);
};

vjs.OffTextTrackMenuItem.prototype.update = function(){
  var tracks = this.player.textTracks,
      i=0, j=tracks.length, track,
      off = true;

  for (;i<j;i++) {
    track = tracks[i];
    if (track.kind == this.track.kind && track.mode == 2) {
      off = false;
    }
  }

  if (off) {
    this.selected(true);
  } else {
    this.selected(false);
  }
};

/* Captions Button
================================================================================ */
/**
 * @constructor
 */
vjs.TextTrackButton = function(player, options){
  goog.base(this, player, options);

  this.menu = this.createMenu();

  if (this.items.length === 0) {
    this.hide();
  }
};
goog.inherits(vjs.TextTrackButton, vjs.Button);

vjs.TextTrackButton.prototype.createMenu = function(){
  var menu = new vjs.Menu(this.player);

  // Add a title list item to the top
  menu.el_.appendChild(vjs.createEl("li", {
    className: "vjs-menu-title",
    innerHTML: vjs.capitalize(this.kind)
  }));

  // Add an OFF menu item to turn all tracks off
  menu.addItem(new vjs.OffTextTrackMenuItem(this.player, { kind: this.kind }))

  this.items = this.createItems();

  // Add menu items to the menu
  for (var i = 0; i < this.items.length; i++) {
    menu.addItem(this.items[i]);
  };

  // Add list to element
  this.addChild(menu);

  return menu;
};

// Create a menu item for each text track
vjs.TextTrackButton.prototype.createItems = function(){
  var items = [], track;

  for (var i = 0; i < this.player.textTracks.length; i++) {
    track = this.player.textTracks[i];
    if (track.kind === this.kind) {
      items.push(new vjs.TextTrackMenuItem(this.player, {
        track: track
      }));
    }
  };

  return items;
};

vjs.TextTrackButton.prototype.buildCSSClass = function(){
  return this.className + " vjs-menu-button " + goog.base(this, 'buildCSSClass');
};

// Focus - Add keyboard functionality to element
vjs.TextTrackButton.prototype.onFocus = function(){
  // Show the menu, and keep showing when the menu items are in focus
  this.menu.lockShowing();
  // this.menu.el_.style.display = "block";

  // When tabbing through, the menu should hide when focus goes from the last menu item to the next tabbed element.
  vjs.one(this.menu.el_.childNodes[this.menu.el_.childNodes.length - 1], "blur", vjs.bind(this, function(){
    this.menu.unlockShowing();
  }));
};
// Can't turn off list display that we turned on with focus, because list would go away.
vjs.TextTrackButton.prototype.onBlur = function(){};

vjs.TextTrackButton.prototype.onClick = function(){
  // When you click the button it adds focus, which will show the menu indefinitely.
  // So we'll remove focus when the mouse leaves the button.
  // Focus is needed for tab navigation.
  this.one("mouseout", vjs.bind(this, function(){
    this.menu.unlockShowing();
    this.el_.blur();
  }));
};

/**
 * @constructor
 */
vjs.CaptionsButton = function(player, options, ready){
  goog.base(this, player, options, ready)
};
goog.inherits(vjs.CaptionsButton, vjs.TextTrackButton);
vjs.CaptionsButton.prototype.kind = "captions";
vjs.CaptionsButton.prototype.buttonText = "Captions";
vjs.CaptionsButton.prototype.className = "vjs-captions-button";

/**
 * @constructor
 */
vjs.SubtitlesButton = function(player, options, ready){
  goog.base(this, player, options, ready);
};
goog.inherits(vjs.SubtitlesButton, vjs.TextTrackButton);
vjs.SubtitlesButton.prototype.kind = "subtitles";
vjs.SubtitlesButton.prototype.buttonText = "Subtitles";
vjs.SubtitlesButton.prototype.className = "vjs-subtitles-button";

// Chapters act much differently than other text tracks
// Cues are navigation vs. other tracks of alternative languages
/**
 * @constructor
 */
vjs.ChaptersButton = function(player, options, ready){
  goog.base(this, player, options, ready);
};
goog.inherits(vjs.ChaptersButton, vjs.TextTrackButton);
vjs.ChaptersButton.prototype.kind = "chapters";
vjs.ChaptersButton.prototype.buttonText = "Chapters";
vjs.ChaptersButton.prototype.className = "vjs-chapters-button";

// Create a menu item for each text track
vjs.ChaptersButton.prototype.createItems = function(chaptersTrack){
  var items = [], track;

  for (var i = 0; i < this.player.textTracks.length; i++) {;
    track = this.player.textTracks[i];
    if (track.kind === this.kind) {
      items.push(new vjs.TextTrackMenuItem(this.player, {
        track: track
      }));
    }
  };

  return items;
};

vjs.ChaptersButton.prototype.createMenu = function(){
  var tracks = this.player.textTracks,
      i = 0,
      j = tracks.length,
      track, chaptersTrack,
      items = this.items = [];

  for (;i<j;i++) {
    track = tracks[i];
    if (track.kind == this.kind && track["default"]) {
      if (track.readyState < 2) {
        this.chaptersTrack = track;
        track.on("loaded", vjs.bind(this, this.createMenu));
        return;
      } else {
        chaptersTrack = track;
        break;
      }
    }
  }

  var menu = this.menu = new vjs.Menu(this.player);

  menu.el_.appendChild(vjs.createEl("li", {
    className: "vjs-menu-title",
    innerHTML: vjs.capitalize(this.kind)
  }));

  if (chaptersTrack) {
    var cues = chaptersTrack.cues,
        i = 0, j = cues.length, cue, mi;

    for (;i<j;i++) {
      cue = cues[i];

      mi = new vjs.ChaptersTrackMenuItem(this.player, {
        track: chaptersTrack,
        cue: cue
      });

      items.push(mi);

      menu.addChild(mi);
    }
  }

  // Add list to element
  this.addChild(menu);

  if (this.items.length > 0) {
    this.show();
  }

  return menu;
};


/**
 * @constructor
 */
vjs.ChaptersTrackMenuItem = function(player, options){
  var track = this.track = options.track,
      cue = this.cue = options.cue,
      currentTime = player.currentTime();

  // Modify options for parent MenuItem class's init.
  options.label = cue.text;
  options.selected = (cue.startTime <= currentTime && currentTime < cue.endTime);
  goog.base(this, player, options);

  track.on("cuechange", vjs.bind(this, this.update));
};
goog.inherits(vjs.ChaptersTrackMenuItem, vjs.MenuItem);

vjs.ChaptersTrackMenuItem.prototype.onClick = function(){
  goog.base(this, 'onClick');
  this.player.currentTime(this.cue.startTime);
  this.update(this.cue.startTime);
};

vjs.ChaptersTrackMenuItem.prototype.update = function(time){
  var cue = this.cue,
      currentTime = this.player.currentTime();

  // vjs.log(currentTime, cue.startTime);
  if (cue.startTime <= currentTime && currentTime < cue.endTime) {
    this.selected(true);
  } else {
    this.selected(false);
  }
};

// Add Buttons to controlBar
vjs.merge(vjs.ControlBar.prototype.options.children, {
  "subtitlesButton": {},
  "captionsButton": {},
  "chaptersButton": {}
});

// vjs.Cue = vjs.Component.extend({
//   init: function(player, options){
//     goog.base(this, player, options);
//   }
// });
