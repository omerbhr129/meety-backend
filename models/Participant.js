const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema({
  fullName: {
    type: String,
    required: [true, 'Full name is required'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    trim: true,
    lowercase: true,
    validate: {
      validator: function(v) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
      },
      message: props => `${props.value} is not a valid email address!`
    }
  },
  phone: {
    type: String,
    trim: true
  },
  company: {
    type: String,
    trim: true
  },
  position: {
    type: String,
    trim: true
  },
  meetings: {
    type: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Meeting'
    }],
    default: []
  },
  lastMeeting: {
    type: Date
  },
  profileImage: {
    type: String
  },
  creator: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  toJSON: {
    virtuals: true
  }
});

// וירטואלים
participantSchema.virtual('meetingsCount').get(function() {
  return this.meetings ? this.meetings.length : 0;
});

// מתודות סטטיות
participantSchema.statics.findOrCreateFromBooking = async function(attendee, meetingId) {
  try {
    let participant = await this.findOne({ email: attendee.email });
    
    if (!participant) {
      participant = new this({
        fullName: attendee.name,
        email: attendee.email,
        phone: attendee.phone,
        meetings: [meetingId],
        lastMeeting: new Date()
      });
    } else {
      if (!participant.meetings.includes(meetingId)) {
        participant.meetings.push(meetingId);
        participant.lastMeeting = new Date();
      }
    }

    await participant.save();
    return participant;
  } catch (error) {
    console.error('Error in findOrCreateFromBooking:', error);
    throw error;
  }
};

module.exports = mongoose.model('Participant', participantSchema);
