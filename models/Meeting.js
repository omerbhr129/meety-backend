const mongoose = require('mongoose');

const meetingSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Meeting title is required']
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator is required']
  },
  duration: {
    type: Number,
    required: [true, 'Duration is required'],
    min: [5, 'Duration must be at least 5 minutes'],
    max: [480, 'Duration cannot exceed 8 hours']
  },
  type: {
    type: String,
    enum: ['video', 'in-person', 'phone'],
    required: [true, 'Meeting type is required']
  },
  availability: {
    sunday: {
      enabled: { type: Boolean, default: false },
      timeSlots: [{
        start: { type: String, required: true },
        end: { type: String, required: true }
      }]
    },
    monday: {
      enabled: { type: Boolean, default: false },
      timeSlots: [{
        start: { type: String, required: true },
        end: { type: String, required: true }
      }]
    },
    tuesday: {
      enabled: { type: Boolean, default: false },
      timeSlots: [{
        start: { type: String, required: true },
        end: { type: String, required: true }
      }]
    },
    wednesday: {
      enabled: { type: Boolean, default: false },
      timeSlots: [{
        start: { type: String, required: true },
        end: { type: String, required: true }
      }]
    },
    thursday: {
      enabled: { type: Boolean, default: false },
      timeSlots: [{
        start: { type: String, required: true },
        end: { type: String, required: true }
      }]
    },
    friday: {
      enabled: { type: Boolean, default: false },
      timeSlots: [{
        start: { type: String, required: true },
        end: { type: String, required: true }
      }]
    },
    saturday: {
      enabled: { type: Boolean, default: false },
      timeSlots: [{
        start: { type: String, required: true },
        end: { type: String, required: true }
      }]
    }
  },
  bookedSlots: [{
    date: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          return /^\d{4}-\d{2}-\d{2}$/.test(v);
        },
        message: props => `${props.value} is not a valid date format (YYYY-MM-DD)`
      }
    },
    time: {
      type: String,
      required: true,
      validate: {
        validator: function(v) {
          return /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(v);
        },
        message: props => `${props.value} is not a valid time format (HH:MM)`
      }
    },
    participant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Participant',
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'completed', 'missed', 'deleted'],
      default: 'pending'
    },
    notificationRead: {
      type: Boolean,
      default: false
    }
  }],
  status: {
    type: String,
    enum: ['active', 'inactive', 'deleted'],
    default: 'active'
  },
  shareableLink: String,
  notificationRead: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
});

// אינדקס משולב על תאריך וזמן לשיפור ביצועים
meetingSchema.index({ 'bookedSlots.date': 1, 'bookedSlots.time': 1 });

// מתודה לבדיקת זמינות - עם אופטימיזציה
meetingSchema.methods.isTimeSlotAvailable = function(date, time) {
  // חיפוש ממוקד עם האינדקס החדש
  return !this.bookedSlots.some(slot => 
    slot.date === date &&
    slot.time === time &&
    slot.status !== 'deleted'
  );
};

// וירטואלים
meetingSchema.virtual('upcomingBookings').get(function() {
  const now = new Date();
  const today = now.toISOString().split('T')[0];
  return this.bookedSlots.filter(slot => {
    return (slot.date > today || (slot.date === today && slot.time > now.getHours() + ':' + now.getMinutes())) && 
           slot.status !== 'deleted';
  });
});

// Pre-save middleware to generate shareableLink
meetingSchema.pre('save', function(next) {
  // Always set the shareableLink to just the ID
  this.shareableLink = this._id.toString();
  next();
});

module.exports = mongoose.model('Meeting', meetingSchema);
