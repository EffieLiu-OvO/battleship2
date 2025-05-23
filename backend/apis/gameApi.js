const express = require("express");
const router = express.Router();
const Game = require("../db/gameModel");
const User = require("../db/userModel");
const jwt = require("jsonwebtoken");

const JWT_SECRET = "your_jwt_secret";

const auth = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ message: "Unauthorized, no token" });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    req.userId = decoded.id;
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(401).json({ message: "Unauthorized, invalid token" });
  }
};

router.get("/", async (req, res) => {
  try {
    const games = await Game.find()
      .populate("creator", "username")
      .populate("players.user", "username")
      .populate("winner", "username")
      .sort({ created: -1 });

    res.json(games);
  } catch (error) {
    console.error("Error getting game list:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.get("/:id", auth, async (req, res) => {
  try {
    const gameId = req.params.id;

    const game = await Game.findById(gameId)
      .populate("creator", "username")
      .populate("players.user", "username")
      .populate("winner", "username");

    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    res.json(game);
  } catch (error) {
    console.error("Error getting game info:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/", auth, async (req, res) => {
  try {
    const { name } = req.body;

    const game = new Game({
      name,
      creator: req.userId,
      status: "waiting",
      players: [{ user: req.userId, ready: false }],
      gameData: {
        boards: {},
        ships: {},
        moves: [],
        currentTurn: null,
      },
    });

    await game.save();

    const populatedGame = await Game.findById(game._id)
      .populate("creator", "username")
      .populate("players.user", "username");

    res.status(201).json(populatedGame);
  } catch (error) {
    console.error("Error creating game:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/join", auth, async (req, res) => {
  try {
    const gameId = req.params.id;

    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    if (game.status !== "waiting") {
      return res
        .status(400)
        .json({ message: "Game has already started or ended" });
    }

    const playerExists = game.players.some(
      (player) => player.user.toString() === req.userId
    );

    if (!playerExists) {
      game.players.push({ user: req.userId, ready: false });
      await game.save();
    } else {
      return res.status(400).json({ message: "You are already in this game" });
    }

    const populatedGame = await Game.findById(game._id)
      .populate("creator", "username")
      .populate("players.user", "username");

    res.json(populatedGame);
  } catch (error) {
    console.error("Error joining game:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/ready", auth, async (req, res) => {
  try {
    const gameId = req.params.id;
    const { ships, board } = req.body;

    console.log("Received ready request");
    console.log("User ID:", req.userId);
    console.log("Game ID:", gameId);
    console.log("Ships data:", JSON.stringify(ships).substring(0, 100) + "...");
    console.log("Board data received:", board ? "Yes" : "No");

    const game = await Game.findById(gameId);
    if (!game) {
      console.log("Game not found");
      return res.status(404).json({ message: "Game not found" });
    }

    let gameData = JSON.parse(JSON.stringify(game.gameData || {}));

    if (!gameData.boards) gameData.boards = {};
    if (!gameData.ships) gameData.ships = {};
    if (!gameData.moves) gameData.moves = [];

    const userId = String(req.userId);
    gameData.boards[userId] = board;
    gameData.ships[userId] = ships;

    console.log("Current gameData structure:", {
      boardKeys: Object.keys(gameData.boards),
      shipKeys: Object.keys(gameData.ships),
    });

    game.gameData = gameData;

    console.log(
      "Updated game data, board keys:",
      Object.keys(game.gameData.boards)
    );
    console.log(
      "Updated game data, ship keys:",
      Object.keys(game.gameData.ships)
    );

    const playerIndex = game.players.findIndex(
      (player) => String(player.user) === userId
    );

    if (playerIndex === -1) {
      return res
        .status(403)
        .json({ message: "You are not a participant in this game" });
    }

    game.players[playerIndex].ready = true;

    const allReady = game.players.every((player) => player.ready);

    if (allReady && game.players.length >= 2 && game.status !== "in_progress") {
      game.status = "in_progress";
      const firstPlayerIndex = Math.floor(Math.random() * game.players.length);
      game.gameData.currentTurn = String(game.players[firstPlayerIndex].user);
      console.log("Game starting! First turn:", game.gameData.currentTurn);
    }

    await game.save();

    const savedGame = await Game.findById(gameId);
    console.log(
      "Verification after save - board keys:",
      Object.keys(savedGame.gameData.boards)
    );
    console.log(
      "Verification after save - ship keys:",
      Object.keys(savedGame.gameData.ships)
    );

    console.log("Game saved successfully");
    res.json(game);
  } catch (error) {
    console.error("Error in ready endpoint:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

router.post("/:id/move", auth, async (req, res) => {
  try {
    const gameId = req.params.id;
    const { row, col } = req.body;

    console.log(
      `Move attempt - Game: ${gameId}, User: ${req.userId}, Position: [${row},${col}]`
    );

    const game = await Game.findById(gameId);
    if (!game) {
      console.log("Game not found");
      return res.status(404).json({ message: "Game not found" });
    }

    if (game.status !== "in_progress") {
      console.log("Game not in progress");
      return res
        .status(400)
        .json({ message: "Game has not started or has ended" });
    }

    const currentTurnId = String(game.gameData.currentTurn);
    const requestUserId = String(req.userId);

    console.log(
      `Turn check - Current turn: ${currentTurnId}, User: ${requestUserId}`
    );

    if (currentTurnId !== requestUserId) {
      console.log(
        `Turn mismatch - Expected: ${currentTurnId}, Received: ${requestUserId}`
      );
      return res.status(403).json({ message: "Not your turn" });
    }

    const opponent = game.players.find(
      (player) => String(player.user) !== requestUserId
    );

    if (!opponent) {
      console.log("Opponent not found");
      return res.status(400).json({ message: "Opponent not found" });
    }

    const opponentId = String(opponent.user);
    console.log(`Opponent ID: ${opponentId}`);

    console.log(
      "Available board keys:",
      Object.keys(game.gameData.boards || {})
    );
    console.log("Available ship keys:", Object.keys(game.gameData.ships || {}));

    if (!game.gameData.boards[opponentId]) {
      console.log(`Initializing missing opponent board for: ${opponentId}`);
      game.gameData.boards[opponentId] = Array(10)
        .fill()
        .map(() => Array(10).fill(null));
    }

    if (!game.gameData.ships[opponentId]) {
      console.log(`Initializing missing opponent ships for: ${opponentId}`);
      game.gameData.ships[opponentId] = [];
    }

    const opponentBoard = game.gameData.boards[opponentId];
    const opponentShips = game.gameData.ships[opponentId];

    if (opponentShips.length === 0) {
      console.log("Opponent hasn't placed ships yet");
      return res.status(400).json({ message: "Opponent not ready" });
    }

    const cellState = opponentBoard[row][col];
    if (cellState && cellState.isHit) {
      console.log("Cell already hit");
      return res
        .status(400)
        .json({ message: "This position has already been attacked" });
    }

    const isHit = cellState && cellState.hasShip;
    console.log(`Move result: ${isHit ? "Hit" : "Miss"}`);

    if (!opponentBoard[row][col]) {
      opponentBoard[row][col] = {};
    }
    opponentBoard[row][col].isHit = true;

    game.gameData.moves.push({
      player: req.userId,
      row,
      col,
      isHit,
      timestamp: Date.now(),
    });

    let hitShipId = null;
    let isSunk = false;
    let isGameOver = false;

    if (isHit) {
      for (const ship of opponentShips) {
        const wasHit = ship.positions.some(
          (pos) => pos.row === row && pos.col === col
        );

        if (wasHit) {
          hitShipId = ship.id;
          console.log(`Hit ship: ${hitShipId}`);

          if (typeof ship.hits !== "number") ship.hits = 0;
          ship.hits += 1;
          game.markModified("gameData.ships");

          isSunk = ship.hits === ship.positions.length;
          if (isSunk) {
            console.log(`Ship sunk: ${hitShipId}`);
          }
          break;
        }
      }

      console.log("Ship hit status:");
      opponentShips.forEach((ship) => {
        console.log(
          `Ship ${ship.id}: ${ship.hits || 0}/${
            ship.positions.length
          } hits - Sunk: ${(ship.hits || 0) === ship.positions.length}`
        );
      });

      isGameOver = opponentShips.every(
        (ship) => ship.hits === ship.positions.length
      );
      console.log(`All ships sunk? ${isGameOver}`);
    }

    if (isGameOver) {
      console.log("GAME OVER - All ships sunk! Setting winner to:", req.userId);
      game.status = "completed";
      game.winner = req.userId;
      game.endTime = Date.now();

      const winner = await User.findById(req.userId);
      if (winner) {
        winner.wins += 1;
        await winner.save();
      }

      const loser = await User.findById(opponentId);
      if (loser) {
        loser.losses += 1;
        await loser.save();
      }
    } else {
      game.gameData.currentTurn = opponentId;
      console.log(`Turn changed to: ${opponentId}`);
    }

    await game.save();
    console.log("Game state saved successfully");

    res.json({
      isHit,
      hitShipId,
      isSunk,
      isGameOver,
      nextTurn: isGameOver ? null : opponentId,
      winnerId: isGameOver ? req.userId : null,
    });
  } catch (error) {
    console.error("Game move error:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/end", auth, async (req, res) => {
  try {
    const gameId = req.params.id;
    const { winnerId } = req.body;

    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    if (game.status === "completed") {
      return res.status(400).json({ message: "Game already ended" });
    }

    const isPlayerInGame = game.players.some(
      (player) => player.user.toString() === req.userId
    );

    if (!isPlayerInGame) {
      return res
        .status(403)
        .json({ message: "You are not a participant in this game" });
    }

    game.status = "completed";
    game.winner = winnerId;
    game.endTime = Date.now();
    await game.save();

    if (winnerId) {
      const winner = await User.findById(winnerId);
      if (winner) {
        winner.wins += 1;
        await winner.save();
      }

      for (const player of game.players) {
        if (player.user.toString() !== winnerId) {
          const loser = await User.findById(player.user);
          if (loser) {
            loser.losses += 1;
            await loser.save();
          }
        }
      }
    }

    const populatedGame = await Game.findById(game._id)
      .populate("creator", "username")
      .populate("players.user", "username")
      .populate("winner", "username");

    res.json(populatedGame);
  } catch (error) {
    console.error("Error ending game:", error);
    res.status(500).json({ message: "Server error" });
  }
});

router.post("/:id/leave", auth, async (req, res) => {
  try {
    const gameId = req.params.id;

    const game = await Game.findById(gameId);
    if (!game) {
      return res.status(404).json({ message: "Game not found" });
    }

    const playerIndex = game.players.findIndex(
      (player) => player.user.toString() === req.userId
    );

    if (playerIndex === -1) {
      return res
        .status(403)
        .json({ message: "You are not a participant in this game" });
    }

    if (game.status === "waiting") {
      game.players = game.players.filter(
        (player) => player.user.toString() !== req.userId
      );

      if (game.players.length === 0) {
        await Game.findByIdAndDelete(gameId);
        return res.json({ message: "Game has been deleted" });
      }

      await game.save();
      return res.json({ message: "Left game successfully" });
    } else if (game.status === "completed") {
      return res.json({ message: "Left completed game successfully" });
    } else if (game.status === "in_progress") {
      game.status = "completed";

      const opponent = game.players.find(
        (player) => player.user.toString() !== req.userId
      );

      if (opponent) {
        game.winner = opponent.user;

        if (!game.endTime) {
          const winner = await User.findById(opponent.user);
          if (winner) {
            winner.wins += 1;
            await winner.save();
          }

          const loser = await User.findById(req.userId);
          if (loser) {
            loser.losses += 1;
            await loser.save();
          }
        }
      }

      if (!game.endTime) {
        game.endTime = Date.now();
      }

      await game.save();
      return res.json({ message: "Left game successfully" });
    }
  } catch (error) {
    console.error("Error leaving game:", error);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
