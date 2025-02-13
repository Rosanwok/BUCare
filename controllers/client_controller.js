const Chats = require("./../models/chat");
const Users = require("./../models/user");
const Rooms = require("./../models/room");
const Therapists = require("./../models/therapist");
const Clients = require("./../models/client");
const Ratings = require("./../models/rating");

// Initialize Packages
const Router = require("express").Router();
const Io = require("./../main");
const Joi = require("@hapi/joi");

// verification route
const verify = require("./auths/verify");

const chatSchema = Joi.object({
  RoomId: Joi.string().required(),
  SpokesPerson: Joi.string().required(),
  Message: Joi.string().required(),
});

Router.get("/rooms", verify, (req, res) => {
  console.log(`Request made to : c${req.url}`);

  // the nav has to appear a bit differntly on only this page so this is how i know it is on this page
  req.user.isVisitingRooms = true;

  Io.on("connection", (socket) => {
    // Io tags the on('connection') event to itself with a callback containing the connected socket so for every new socket that connects it
    // attaches the connection event multiple time and fires again for all the old ones and the new ones. So i kill the event after it has finished below

    socket.join(req.user._id.toString()); // rooms have to be strings

    if (socket.rooms.has(req.user._id.toString())) {
      Io.to(socket.id).emit("ack_rooms", "success");
    } else {
      Io.to(socket.id).emit("ack_rooms", "failed");
    }

    // this code alerts all users that this person is now online
    const nowOnline = () => {
      // get all rooms that this person participates in
      Rooms.find({ ClientId: req.user._id })
        .then(async (room_docs) => {
          for (let index = 0; index < room_docs.length; index++) {
            const room = room_docs[index];
            socket.to(room.TherapistId).emit("isOnline", room._id);
          }
        })
        .catch((err) => {
          if (err) console.log(err);
        });
    };

    nowOnline();

    socket.on("chat_message", async function (data) {

      try {
        await chatSchema.validateAsync(data);

        Chats(data).save((err, chat_docs) => {
          if (err) {
            console.log(err);
          } else {
            Rooms.findOne({ _id: data.RoomId })
              .then((room_docs) => {
                if (room_docs.TherapistId == data.SpokesPerson) {
                  data.reciever = room_docs.ClientId;
                } else {
                  data.reciever = room_docs.TherapistId;
                }

                data.ChatId = chat_docs._id;

                socket.to(data.reciever).emit("msg", data);
              })
              .catch((err) => {
                console.log(err);
              });
          }
        });
      } catch (error) {
        return res.status(400).send(errors.details[0].message);
      }

    });

    socket.on("message_status", (data) => {
      Chats.findByIdAndUpdate(data.ChatId.toString(), { Status: data.status })
        .then((docs) => {
          // emit an event so you can update the ui to show the message has been deleivered
          socket.to(data.SpokesPerson).emit("delivered");
        })
        .catch((err) => {
          console.log(err);
        });
    });

    socket.on("deliver_all", function (userId) {
      // get all rooms that this person participates in and then every chat where he is not the spokes man
      Rooms.find({ ClientId: userId })
        .then(async (docs) => {
          const loop = async (_) => {
            for (let index = 0; index < docs.length; index++) {
              const room = docs[index];

              const roomId = room._id;
              // $ne means not equal to

              await Chats.updateMany(
                {
                  RoomId: roomId,
                  SpokesPerson: { $ne: userId },
                  Status: { $ne: "delivered", $ne: "seen" },
                },
                { Status: "delivered" }
              )
                .then((chat_docs) => {
                  // modifiedCount holds the number of chats it modified

                  if (chat_docs.modifiedCount != 0) {
                    // i send back a message for the frontend to update the ui
                    // even if the person is offline it doesnt matter i still updated the db
                    socket
                      .to(room.TherapistId)
                      .emit("seen_all_completed", roomId);
                  }
                })
                .catch((err) => {
                  if (err) console.log(err);
                });
            }
          };

          await loop();
        })
        .catch((err) => {
          if (err) console.log(err);
        });
    });

    socket.on("seen_all_in_room", function (userId, roomId) {
      // get all rooms that this person participates in and then every chat where he is not the spokes man
      Rooms.find({ ClientId: userId })
        .then(async (docs) => {
          const loop = async (_) => {
            for (let index = 0; index < docs.length; index++) {
              const room = docs[index];

              const roomId = room._id;
              // $ne means not equal to
              await Chats.updateMany(
                {
                  RoomId: roomId,
                  SpokesPerson: { $ne: userId },
                  Status: { $ne: "seen" },
                },
                { Status: "seen" }
              )
                .then((chat_docs) => {
                  if (chat_docs.modifiedCount != 0) {
                    // i send back a message for the frontend to update the ui
                    // even if the person is offline it doesnt matter i still updated the db
                    socket
                      .to(room.TherapistId)
                      .emit("seen_all_completed", roomId);
                  }
                })
                .catch((err) => {
                  if (err) console.log(err);
                });
            }
          };

          await loop();
        })
        .catch((err) => {
          if (err) console.log(err);
        });
    });

    socket.on("left_room", function (roomId) {
      Rooms.findById(roomId)
        .then((room_docs) => {
          socket.to(room_docs.TherapistId).emit("disbanded_room", roomId);
        })
        .catch((err) => {
          if (err) console.log(err);
        });
    });

    socket.on("is_online_processed", (roomId) => {
      Rooms.findById(roomId)
        .then((docs) => {
          // because this handles events from client so the reciever is automatically the therapist
          let reciever = docs.TherapistId;
          Io.to(reciever).emit("isAlsoOnline", roomId);

          // what happens here is that once the therapist confirms what rooms are active (are online) he activates the start/end a session feature
          Io.to(reciever).emit("enable_session_toggle", roomId);
        })
        .catch((err) => {
          if (err) console.log(err);
        });
    });

    socket.on('start_voice_call', roomId => {
      Rooms.findById(roomId)
        .then(docs => {
          if (docs) {
            const data = {
              RoomId: docs._id,
              Message: `Voice chat started at <a href="/video/${roomId}/voice" target="_blank">Here</a>`
            }
            Io.to(docs.TherapistId).emit('voip_started', data);
            Io.to(docs.ClientId).emit('voip_started', data);
          }
        })
    });

    socket.on('start_video_call', roomId => {
      Rooms.findById(roomId)
        .then(docs => {
          if (docs) {
            const data = {
              RoomId: docs._id,
              Message: `Voice chat started at <a href="/video/${roomId}/video" target="_blank">Here</a>`
            }
            Io.to(docs.TherapistId).emit('voip_started', data);
            Io.to(docs.ClientId).emit('voip_started', data);
          }
        })
    });

    const wentOffline = () => {
      // get all rooms that this person participates in
      Rooms.find({ ClientId: req.user._id })
        .then(async (room_docs) => {
          for (let index = 0; index < room_docs.length; index++) {
            const room = room_docs[index];
            socket.to(room.TherapistId).emit("wentOffline", room._id);
          }
        })
        .catch((err) => {
          if (err) console.log(err);
        });
    };

    // this code alerts all users that this person has gone offline
    socket.on("disconnect", wentOffline);

    // i kill the listener so for every new connection its a new listener
    Io.removeAllListeners("connection");
  });

  // retrieve all the rooms the current user is in
  if (req.user.isClient) {
    Rooms.find({ ClientId: req.user._id })
      .then(async (rooms) => {
        const loop = async (_) => {
          for (let index = 0; index < rooms.length; index++) {
            const room = rooms[index];

            await Chats.find({ RoomId: room._id })
              .limit(15)
              .then((chats) => {
                rooms[index].Chats = chats;
              })
              .catch((err) => {
                if (err) console.log(err);
              });

            await Users.findOne({ _id: room.TherapistId })
              .then(async (user) => {
                await Therapists.findOne({ Email: user.Email })
                  .then((therapist) => {
                    rooms[index].Username =
                      therapist.First_Name + " " + therapist.Last_Name;
                    rooms[index].Sex = therapist.Sex;
                    rooms[index].Display_Picture = therapist.Display_Picture;
                  })
                  .catch((err) => {
                    if (err) console.log(err);
                  });
              })
              .catch((err) => {
                if (err) console.log(err);
              });
          }
        };

        // Start the function and waits till everything finishes
        await loop();

        // get the user's record from database and send to the frontend useful in the chat page for the profile nav
        await Users.findById(req.user._id)
          .then(async (users_docs) => {
            await Clients.findOne({ Email: users_docs.Email })
              .then((docs) => {
                req.user.details = docs;
              })
              .catch((err) => {
                if (err) console.log(err);
              });
          })
          .catch((err) => {
            if (err) console.log(err);
          });

        res.render("rooms", {
          rooms_info: rooms,
          userStatus: req.user,
          user: req.user._id,
        });
      })
      .catch((err) => {
        res.send(err);
      });
  } else {
    req.errorMessage =
      "Unauthorized access to the requested page. <br> If you believe this to be an error please file a report on the contact us page.";
    res.redirect(307, "/");
  }
});

Router.get("/getinfo/:userId", verify, (req, res) => {
  console.log(`Request made to : t${req.url}`);

  Users.findById(req.params.userId)
    .then((docs) => {
      if (docs) {
        Therapists.findOne({ Email: docs.Email }).then((t_docs) => {
          if (t_docs) {
            // removes confidential info from the response
            t_docs = {
              First_Name: t_docs.First_Name,
              Last_Name: t_docs.Last_Name,
              Email: t_docs.Email,
              Telephone: t_docs.Telephone,
              Sex: t_docs.Sex,
              Average_Rating: t_docs.Average_Rating,
            };

            Rooms.find({ TherapistId: req.params.userId, Status: true })
              .then(r_docs => {
                if (r_docs) {
                  // this for now returns all the clients this therapist is attending to
                  t_docs.Clients_Count = r_docs.length;

                  res.status(200).send(t_docs);

                }
              })

          } else {
            res.status(401).send("User not found");
          }
        });
      } else {
        res.status(401).send("User not found");
      }
    })
    .catch((err) => {
      res.status(500).send("Sorry something went wrong");
    });
});

// Joi Schema for rating
const ratingSchema = Joi.object({
  ClientId: Joi.string().required(),
  TherapistId: Joi.string().required(),
  Rating: Joi.number().required(),
});

Router.put("/ratetherapist", verify, (req, res) => {
  if (req.user.isClient) {
    let data = req.body;

    if (data.roomId === null || data.rating === null) {
      return res.status(400).send();
    }

    let therapistId;
    let clientId = req.user._id;
    let previousAverageRating, previousRatingRespondent;

    Rooms.findById(data.roomId)
      .then((rooms) => {
        if (!rooms) {
          return res.status(400).send();
        }

        // if user is no longer a part of the room
        if (rooms.Status == false) {
          return res.status(400).send();
        }

        therapistId = rooms.TherapistId;

        // the following line retrieves the modt recent document that meets the criteria
        // sort({_id: -1}) means in descending order (-1), 1 means ascending order
        // limit, limits the number of results
        Ratings.find({ ClientId: req.user._id, TherapistId: therapistId })
          .sort({ _id: -1 })
          .limit(1)
          .then(async (docs) => {
            if (!docs) {
              return res.status(400).send();
            }

            // if there has been a record previously
            if (docs.length > 0) {
              let lastRatingTime = new Date(docs[0].createdAt).getTime();
              let now = Date.now();

              let differnce = now - lastRatingTime;

              let hourInMilliSeconds = 1000 * 60 * 60;

              if (differnce < hourInMilliSeconds) {
                return res.status(429).send();
              }
            }
            let therapistEmail; // used to work with the therapist model

            await Users.findById(therapistId)
              .then((docs) => {
                therapistEmail = docs.Email;
              })
              .catch((err) => {
                console.log(err);
                return res.status(500).send();
              });

            Therapists.findOne({ Email: therapistEmail })
              .then((therapists_docs) => {
                if (!therapists_docs) {
                  return res.status(400).send();
                }

                previousAverageRating = therapists_docs.Average_Rating
                  ? therapists_docs.Average_Rating
                  : 0;
                previousRatingRespondent = therapists_docs.Rating_Respondents
                  ? therapists_docs.Rating_Respondents
                  : 0;

                let newRatingRespondents = previousRatingRespondent + 1;
                let newAverageRating =
                  (previousAverageRating * previousRatingRespondent +
                    data.rating) /
                  newRatingRespondents;

                newAverageRating = newAverageRating.toFixed(2);

                Therapists.findOneAndUpdate(
                  { Email: therapistEmail },
                  {
                    Rating_Respondents: newRatingRespondents,
                    Average_Rating: newAverageRating,
                  }
                )
                  .then(async (docs) => {
                    const ratingData = {
                      ClientId: clientId,
                      TherapistId: therapistId,
                      Rating: data.rating,
                    };

                    try {
                      await ratingSchema.validateAsync(ratingData);

                      Ratings(ratingData).save((err, docs) => {
                        if (err) {
                          return res.status(500).send();
                        } else {
                          // send back the id of the newly creaated rating so i can use it to append the comment
                          return res.status(200).send(docs._id);
                        }
                      });
                    } catch (error) {
                      res.status(400).send(error.details[0].message)
                    }

                  })
                  .catch((err) => {
                    console.log(err);
                    return res.status(500).send();
                  });

                // find the therapist id, then get his curent rating do the maths and then insert into the rating model and therapist model their
                // respective data
              })
              .catch((err) => {
                console.log(err);
                return res.status(500).send();
              });
          });
      })
      .catch((err) => {
        console.log(err);
        return res.status(500).send();
      });
  } else {
    return res.status(401).send();
  }
});

Router.put('/updateRating', (req, res) => {
  const id = req.body.docsId;
  const comment = req.body.comment;

  if (!id || !comment) {
    return res.status(400).send();
  }

  Ratings.findByIdAndUpdate(id, { Comment: req.body.comment })
    .then(docs => {
      if (docs) {
        return res.status(200).send();
      } else {
        return res.status(400).send();
      }
    })
    .catch(err => {
      if (err) console.error(err);

      return res.status(500).send();
    })
});

Router.get('/search/:query', verify, async (req, res) => {
  console.log(`Request made to : t${req.url}`);

  const { query } = req.params;
  const { _id: userId } = req.user;

  let results = [];

  let therapist_info;
  await Users.find({ isTherapist: true, $or: [{ First_Name: { $regex: query, $options: 'i' } }, { Last_Name: { $regex: query, $options: 'i' } },] })
    .then(docs => {
      if (docs) {
        therapist_info = docs;
      } else {
        return res.status(400);
      }
    })
    .catch(err => {
      console.log(err);
      return res.status(500).send('Something went wrong');
    })

  const loop1 = async function () {
    for (let index = 0; index < therapist_info.length; index++) {
      await Rooms.find({ ClientId: userId, TherapistId: therapist_info[index]._id })
        .then(r_docs => {
          if (r_docs.length > 0) {
            r_docs.forEach(data => {
              results.push({
                _id: data._id,
                Display_Picture: therapist_info[index].Display_Picture,
                Sex: therapist_info[index].Sex,
                Chats: [],
                Username: therapist_info[index].First_Name + ' ' + therapist_info[index].Last_Name,
              })
            })
          } else {
            return res.status(400);
          }
        })
        .catch(err => {
          console.log(err);
          return res.status(500).send('Something went wrong');
        })
    }
  }

  await loop1();

  const loop2 = async function () {
    for (let index = 0; index < results.length; index++) {
      await Chats.find({ RoomId: results[index]._id })
        .sort({ _id: -1 }) // means descending order the _id has time builtin
        .limit(1)
        .then(c_docs => {
          if (c_docs.length > 0) {
            results[index].Chats = c_docs;
          } else {
            return res.status(400);
          }
        })
        .catch(err => {
          console.log(err);
          return res.status(500).send('Something went wrong');
        })
    }
  }

  await loop2();

  res.status(200).send(results);

});

// This makes sure all normal routes called from the client route c/ will redirect backwards
Router.get("/", (req, res) => {
  res.redirect("../");
});

Router.get("/index", (req, res) => {
  res.redirect("../index");
});

Router.get("/about", (req, res) => {
  res.redirect("../about");
});

Router.get("/contact", (req, res) => {
  res.redirect("../contact");
});

Router.get("/services", (req, res) => {
  res.redirect("../services");
});

module.exports = Router;
