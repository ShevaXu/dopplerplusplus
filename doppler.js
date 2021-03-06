window.doppler = (function() {
  var AuContext = (window.AudioContext ||
                   window.webkitAudioContext ||
                   window.mozAudioContext ||
                   window.oAudioContext ||
                   window.msAudioContext);
  // create later, to allow re-start
  var ctx;
  var osc;
  var gainNode;

  // really need to cache the stream???
  var streamRef;

  // This is just preliminary, we'll actually do a quick scan
  // (as suggested in the paper) to optimize this.
  var freq = 20000;

  // See paper for this particular choice of frequencies
  var relevantFreqWindow = 33;

  var getBandwidth = function(analyser, freqs) {
    var primaryTone = freqToIndex(analyser, freq);
    var primaryVolume = freqs[primaryTone];
    // This ratio is totally empirical (aka trial-and-error).
    var maxVolumeRatio = 0.1;
    var doSecondScan = true;
    var band = {};

    var leftBandwidth = 0;
    do {
      leftBandwidth++;
      var volume = freqs[primaryTone-leftBandwidth];
      var normalizedVolume = volume / primaryVolume;
    } while (normalizedVolume > maxVolumeRatio && leftBandwidth < relevantFreqWindow);
    band.left = leftBandwidth;

    if (doSecondScan) {
      var secondScanRatio = 0.3;
      var secondBW = leftBandwidth;
      var tmpMaxVolume = 0;
      var secondPeak = -1;
      // find if there's a peak over that ratio
      do {
        secondBW++;
        var volume = freqs[primaryTone-secondBW];
        var normalizedVolume = volume / primaryVolume;
        if (normalizedVolume > tmpMaxVolume) {
          tmpMaxVolume = normalizedVolume;
          secondPeak = secondBW;
        }
      } while (secondBW < relevantFreqWindow);
      if (tmpMaxVolume > secondScanRatio) {
        // console.log("Find second peak!");
        // repeat the first scan process
        var secondVolume = tmpMaxVolume * primaryVolume;
        secondBW = secondPeak;
        do {
          secondBW++;
          var volume = freqs[primaryTone-secondBW];
          var normalizedVolume = volume / secondVolume;
        } while (normalizedVolume > maxVolumeRatio && secondBW < relevantFreqWindow);
        band.secondLeft = secondBW;     
      };
    };

    var rightBandwidth = 0;
    do {
      rightBandwidth++;
      var volume = freqs[primaryTone+rightBandwidth];
      var normalizedVolume = volume / primaryVolume;
    } while (normalizedVolume > maxVolumeRatio && rightBandwidth < relevantFreqWindow);
    band.right = rightBandwidth;

    if (doSecondScan) {
      var secondScanRatio = 0.3;
      var secondBW = rightBandwidth;
      var tmpMaxVolume = 0;
      var secondPeak = -1;
      // find if there's a peak over that ratio
      do {
        secondBW++;
        var volume = freqs[primaryTone-secondBW];
        var normalizedVolume = volume / primaryVolume;
        if (normalizedVolume > tmpMaxVolume) {
          tmpMaxVolume = normalizedVolume;
          secondPeak = secondBW;
        }
      } while (secondBW < relevantFreqWindow);
      if (tmpMaxVolume > secondScanRatio) {
        // console.log("Find second peak!");
        // repeat the first scan process
        var secondVolume = tmpMaxVolume * primaryVolume;
        secondBW = secondPeak;
        do {
          secondBW++;
          var volume = freqs[primaryTone-secondBW];
          var normalizedVolume = volume / secondVolume;
        } while (normalizedVolume > maxVolumeRatio && secondBW < relevantFreqWindow);
        band.secondRight = secondBW;   
      };
    };

    return band;
  };

  var freqToIndex = function(analyser, freq) {
    var nyquist = ctx.sampleRate / 2;
    return Math.round( freq/nyquist * analyser.fftSize/2 );
  };

  var indexToFreq = function(analyser, index) {
    var nyquist = ctx.sampleRate / 2;
    return nyquist/(analyser.fftSize/2) * index;
  };

  var optimizeFrequency = function(osc, analyser, freqSweepStart, freqSweepEnd) {
    var oldFreq = osc.frequency.value;

    var audioData = new Uint8Array(analyser.frequencyBinCount);
    var maxAmp = 0;
    var maxAmpIndex = 0;

    var from = freqToIndex(analyser, freqSweepStart);
    var to   = freqToIndex(analyser, freqSweepEnd);
    for (var i = from; i < to; i++) {
      osc.frequency.value = indexToFreq(analyser, i);
      analyser.getByteFrequencyData(audioData);

      if (audioData[i] > maxAmp) {
        maxAmp = audioData[i];
        maxAmpIndex = i;
      }
    }
    // Sometimes the above procedure seems to fail, not sure why.
    // If that happends, just use the old value.
    if (maxAmpIndex == 0) {
      return oldFreq;
    }
    else {
      return indexToFreq(analyser, maxAmpIndex);
    }
  };

  var readMicInterval = 0;
  var switchGainInterval = 0;

  var readMic = function(analyser, userCallback) {
    var audioData = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(audioData);

    var primaryTone = freqToIndex(analyser, freq);
    var from = primaryTone - relevantFreqWindow;
    var to   = primaryTone + relevantFreqWindow;

    var band = getBandwidth(analyser, audioData);
    userCallback(band, audioData, primaryTone, from, to);

    readMicInterval = setTimeout(readMic, 1, analyser, userCallback);
  };

  var switchGain = function(delay) {
    gainNode.gain.value = gainNode.gain.value? 0: 1;
    switchGainInterval = setTimeout(switchGain, delay, delay);
  }

  var handleMic = function(stream, callback, userCallback) {
    ctx = new AudioContext();
    // Mic
    var mic = ctx.createMediaStreamSource(stream);
    var analyser = ctx.createAnalyser();

    analyser.smoothingTimeConstant = 0.5;
    analyser.fftSize = 2048;

    mic.connect(analyser);

    // Doppler tone
    osc = ctx.createOscillator();
    osc.frequency.value = freq;
    osc.type = osc.SINE;
    osc.start(0);

    gainNode = ctx.createGain();
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);

    // There seems to be some initial "warm-up" period
    // where all frequencies are significantly louder.
    // A quick timeout will hopefully decrease that bias effect.
    setTimeout(function() {
      // Optimize doppler tone
      freq = optimizeFrequency(osc, analyser, 19000, 22000);
      osc.frequency.value = freq;

      clearInterval(readMicInterval);
      clearInterval(switchGainInterval);

      switchGain(100);
      callback(analyser, userCallback);
    });
  };

  return {
    init: function(callback) {
      navigator.getUserMedia_ = (navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia);
      navigator.getUserMedia_({ audio: { optional: [{ echoCancellation: false }] } }, function(stream) {
        streamRef = stream;
        handleMic(stream, readMic, callback);
      }, function() { console.log('Error!') });
    },
    stop: function () {
      clearInterval(readMicInterval);
      clearInterval(switchGainInterval);
      osc.stop(0);
    },
    restart: function(callback) {
      handleMic(streamRef, readMic, callback);
    },
    initialized: function () {
      return streamRef || false;
    }
  }
})(window, document);

