import '@openzeppelin/contracts/access/Ownable.sol';
import './IRockPaperScissors.sol';
import './IRPS.sol';

//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

contract RockPaperScissors is IRockPaperScissors, Ownable {
  IRPS public immutable rps;
  Game[] public games;
  mapping(address => uint256) public playerToId;
  mapping(uint256 => uint256) private _gameIdToIndex;
  uint256 public gamesCreated;
  uint256 public totalPlayerIds;
  uint256 public rpsPrice = 0.01 ether;
  uint8 public rpsFee = 10;

  event GameCreated(address indexed _creator, uint256 indexed _gameId, Game _game);
  event GameStarted(address indexed _starter, uint256 indexed _gameId, Game _game);
  event GameEnded(address indexed _ender, uint256 indexed _gameId, Game _game);
  event GameDeleted(address indexed _deleter, uint256 indexed _gameId, Game _game);
  event RPSBought(address indexed _minter, uint256 _amount);
  event RPSSold(address indexed _burner, uint256 _amount);
  event RPSPriceChanged(uint256 _oldRPSPrice, uint256 _newRPSPrice);
  event RPSFeeChanged(uint256 _oldRPSFee, uint256 _newRPSFee);
  event EtherReceived(address indexed _sender, uint256 _value);
  event EtherWithdrawn(address indexed _withdrawer, uint256 _value);

  modifier checkGame(uint256 _gameId, uint256 _path) {
    require(games.length != 0, 'The games list is empty');
    Game memory gameM = games[_gameIdToIndex[_gameId]];
    require(_gameId < gamesCreated, 'Game does not exist');
    require(gameM.id == _gameId, 'Game has been deleted');
    if (_path == 0) {
      require(gameM.status == Status.CREATED, 'Game has already started');
    } else if (_path == 1) {
      if (gameM.status != Status.STARTED) {
        require(gameM.status != Status.CREATED, 'Game has not started yet');
        revert('Game has already ended');
      }
      require(gameM.player1 == msg.sender, 'Player 1 is not you');
    } else if (_path == 2) {
      require(gameM.player2 == msg.sender, 'Player 2 is not you');
    } else {
      require(gameM.status == Status.CREATED, 'Game has already started');
      require(gameM.player1 == msg.sender, 'Player 1 is not you');
    }
    _;
  }

  constructor(address _rpsContractAddress) {
    rps = IRPS(_rpsContractAddress);
  }

  receive() external payable {
    if (msg.value > 0) {
      emit EtherReceived(msg.sender, msg.value);
    }
  }

  fallback() external payable {
    revert('Wrong call to contract');
  }

  function buyRPS() external payable override {
    require(msg.value % rpsPrice == 0 && msg.value != 0, 'Wrong ether sent');
    uint256 amount = msg.value / rpsPrice;
    rps.mint(msg.sender, amount);
    emit RPSBought(msg.sender, amount);
  }

  function sellRPS(uint256 _amount) external override {
    require(_amount != 0, 'Token amount cannot be zero');
    rps.burn(msg.sender, _amount);
    emit RPSSold(msg.sender, _amount);
    uint256 rpsBidPrice = rpsPrice - (rpsPrice * rpsFee) / 100;
    //solhint-disable-next-line
    (bool sent, ) = msg.sender.call{value: rpsBidPrice * _amount}('');
    require(sent, 'Failed to send ether');
  }

  function createGame(
    bytes32 _encryptedMove,
    uint256 _bet,
    uint16 _duration
  ) external override {
    require(_bet <= (2**256 - 2) / 2, 'The bet is too big');
    rps.burn(msg.sender, _bet);
    Game memory newGame;
    newGame.id = gamesCreated++;
    newGame.player1 = msg.sender;
    newGame.bet = _bet;
    newGame.duration = _duration;
    newGame.encryptedMove = _encryptedMove;
    _gameIdToIndex[newGame.id] = games.length;
    games.push(newGame);
    emit GameCreated(msg.sender, newGame.id, newGame);
    if (playerToId[msg.sender] == 0) {
      playerToId[msg.sender] = ++totalPlayerIds;
    }
  }

  function quitGame(uint256 _gameId) external override checkGame(_gameId, 3) {
    Game storage game = games[_gameIdToIndex[_gameId]];
    rps.mint(msg.sender, game.bet);
    _deleteGame(_gameId);
  }

  function playGame(uint256 _gameId, Hand _move) external override checkGame(_gameId, 0) {
    require(_move != Hand.IDLE, 'Invalid move');
    Game memory gameM = games[_gameIdToIndex[_gameId]];
    rps.burn(msg.sender, gameM.bet);
    gameM.player2 = msg.sender;
    gameM.timestamp = block.timestamp;
    gameM.move = _move;
    gameM.status = Status.STARTED;
    games[_gameIdToIndex[_gameId]] = gameM;
    emit GameStarted(msg.sender, _gameId, gameM);
    if (playerToId[msg.sender] == 0) {
      playerToId[msg.sender] = ++totalPlayerIds;
    }
  }

  function endGameAsPlayer1(uint256 _gameId, bytes calldata _seed) external override checkGame(_gameId, 1) {
    Game memory gameM = _decryptMove(_gameId, _seed);
    if (gameM.decryptedMove == gameM.move) {
      gameM.status = Status.TIE;
      games[_gameIdToIndex[_gameId]] = gameM;
      emit GameEnded(msg.sender, _gameId, gameM);
      rps.mint(msg.sender, gameM.bet);
    } else if ((uint8(gameM.decryptedMove) + 3 - uint8(gameM.move)) % 3 == 1) {
      gameM.status = Status.PLAYER1;
      games[_gameIdToIndex[_gameId]] = gameM;
      emit GameEnded(msg.sender, _gameId, gameM);
      rps.mint(msg.sender, gameM.bet * 2);
      _deleteGame(_gameId);
    } else {
      gameM.status = Status.PLAYER2;
      games[_gameIdToIndex[_gameId]] = gameM;
      emit GameEnded(msg.sender, _gameId, gameM);
    }
  }

  function endGameAsPlayer2(uint256 _gameId) external override checkGame(_gameId, 2) {
    Game storage game = games[_gameIdToIndex[_gameId]];
    Game memory gameM = games[_gameIdToIndex[_gameId]];
    if (gameM.status == Status.TIE) {
      rps.mint(msg.sender, gameM.bet);
      _deleteGame(_gameId);
    } else if (gameM.status == Status.STARTED) {
      //solhint-disable-next-line
      require(block.timestamp >= gameM.timestamp + gameM.duration, 'Player 1 still has time to reveal his move');
      game.status = Status.PLAYER2;
      emit GameEnded(msg.sender, _gameId, game);
      rps.mint(msg.sender, gameM.bet * 2);
      _deleteGame(_gameId);
    } else {
      rps.mint(msg.sender, gameM.bet * 2);
      _deleteGame(_gameId);
    }
  }

  function withdrawEtherBalance(uint256 _value) external onlyOwner {
    require(address(this).balance >= _value, 'Insufficient ether in balance');
    //solhint-disable-next-line
    (bool sent, ) = msg.sender.call{value: _value}('');
    require(sent, 'Failed to send ether');
    emit EtherWithdrawn(msg.sender, _value);
  }

  function setRPSPrice(uint256 _rpsPrice) external onlyOwner {
    require(_rpsPrice != 0, 'Token price cannot be zero');
    emit RPSPriceChanged(rpsPrice, _rpsPrice);
    rpsPrice = _rpsPrice;
  }

  function setRPSFee(uint8 _rpsFee) external onlyOwner {
    require(_rpsFee <= 100, 'Invalid fee percentage');
    emit RPSFeeChanged(rpsFee, _rpsFee);
    rpsFee = _rpsFee;
  }

  function getGames() external view override returns (Game[] memory) {
    return games;
  }

  function getAvailableGames() external view override returns (Game[] memory) {
    uint256 availableGamesIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED) {
        availableGamesIndex++;
      }
    }
    Game[] memory availableGames = new Game[](availableGamesIndex);
    delete availableGamesIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED) {
        availableGames[availableGamesIndex] = games[i];
        availableGamesIndex++;
      }
    }
    return availableGames;
  }

  function getAvailableGamesByPlayer(address _player) external view override returns (Game[] memory) {
    uint256 availableGamesByPlayerIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED && games[i].player1 == _player) {
        availableGamesByPlayerIndex++;
      }
    }
    Game[] memory availableGamesByPlayer = new Game[](availableGamesByPlayerIndex);
    delete availableGamesByPlayerIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED && games[i].player1 == _player) {
        availableGamesByPlayer[availableGamesByPlayerIndex] = games[i];
        availableGamesByPlayerIndex++;
      }
    }
    return availableGamesByPlayer;
  }

  function getAvailablePlayers() external view override returns (address[] memory) {
    uint256 preAvailablePlayersIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED) {
        preAvailablePlayersIndex++;
      }
    }
    address[] memory preAvailablePlayers = new address[](preAvailablePlayersIndex);
    delete preAvailablePlayersIndex;
    uint256 availablePlayersIndex;
    uint256 playerCount;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED) {
        preAvailablePlayers[preAvailablePlayersIndex] = games[i].player1;
        preAvailablePlayersIndex++;
        for (uint256 j; j < preAvailablePlayersIndex; j++) {
          if (preAvailablePlayers[j] == games[i].player1) {
            playerCount++;
          }
        }
        if (playerCount == 1) {
          availablePlayersIndex++;
        }
        delete playerCount;
      }
    }
    address[] memory availablePlayers = new address[](availablePlayersIndex);
    delete preAvailablePlayersIndex;
    delete availablePlayersIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.CREATED) {
        preAvailablePlayersIndex++;
        for (uint256 j; j < preAvailablePlayersIndex; j++) {
          if (preAvailablePlayers[j] == games[i].player1) {
            playerCount++;
          }
        }
        if (playerCount == 1) {
          availablePlayers[availablePlayersIndex] = games[i].player1;
          availablePlayersIndex++;
        }
        delete playerCount;
      }
    }
    return availablePlayers;
  }

  function getActiveGames() external view override returns (Game[] memory) {
    uint256 activeGamesIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status != Status.CREATED) {
        activeGamesIndex++;
      }
    }
    Game[] memory activeGames = new Game[](activeGamesIndex);
    delete activeGamesIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status != Status.CREATED) {
        activeGames[activeGamesIndex] = games[i];
        activeGamesIndex++;
      }
    }
    return activeGames;
  }

  function getActiveGamesByPlayer(address _player) external view override returns (Game[] memory) {
    uint256 activeGamesByPlayerIndex;
    for (uint256 i; i < games.length; i++) {
      if (
        (games[i].status == Status.STARTED && games[i].player1 == _player) || (games[i].status != Status.CREATED && games[i].player2 == _player)
      ) {
        activeGamesByPlayerIndex++;
      }
    }
    Game[] memory activeGamesByPlayer = new Game[](activeGamesByPlayerIndex);
    delete activeGamesByPlayerIndex;
    for (uint256 i; i < games.length; i++) {
      if (
        (games[i].status == Status.STARTED && games[i].player1 == _player) || (games[i].status != Status.CREATED && games[i].player2 == _player)
      ) {
        activeGamesByPlayer[activeGamesByPlayerIndex] = games[i];
        activeGamesByPlayerIndex++;
      }
    }
    return activeGamesByPlayer;
  }

  function getActivePlayers() external view override returns (address[] memory) {
    uint256 preActivePlayersIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.STARTED) {
        preActivePlayersIndex += 2;
      } else if (games[i].status != Status.CREATED) {
        preActivePlayersIndex++;
      }
    }
    address[] memory preActivePlayers = new address[](preActivePlayersIndex);
    delete preActivePlayersIndex;
    uint256 activePlayersIndex;
    uint256 player1Count;
    uint256 player2Count;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.STARTED && games[i].player1 != games[i].player2) {
        preActivePlayers[preActivePlayersIndex] = games[i].player1;
        preActivePlayersIndex++;
        preActivePlayers[preActivePlayersIndex] = games[i].player2;
        preActivePlayersIndex++;
        for (uint256 j; j < preActivePlayersIndex; j++) {
          if (preActivePlayers[j] == games[i].player1) {
            player1Count++;
          } else if (preActivePlayers[j] == games[i].player2) {
            player2Count++;
          }
        }
        if (player1Count == 1) {
          activePlayersIndex++;
        }
        if (player2Count == 1) {
          activePlayersIndex++;
        }
        delete player1Count;
        delete player2Count;
      } else if (games[i].status != Status.CREATED) {
        preActivePlayers[preActivePlayersIndex] = games[i].player2;
        preActivePlayersIndex++;
        for (uint256 j; j < preActivePlayersIndex; j++) {
          if (preActivePlayers[j] == games[i].player2) {
            player2Count++;
          }
        }
        if (player2Count == 1) {
          activePlayersIndex++;
        }
        delete player2Count;
      }
    }
    address[] memory activePlayers = new address[](activePlayersIndex);
    delete preActivePlayersIndex;
    delete activePlayersIndex;
    for (uint256 i; i < games.length; i++) {
      if (games[i].status == Status.STARTED && games[i].player1 != games[i].player2) {
        preActivePlayersIndex += 2;
        for (uint256 j; j < preActivePlayersIndex; j++) {
          if (preActivePlayers[j] == games[i].player1) {
            player1Count++;
          } else if (preActivePlayers[j] == games[i].player2) {
            player2Count++;
          }
        }
        if (player1Count == 1) {
          activePlayers[activePlayersIndex] = games[i].player1;
          activePlayersIndex++;
        }
        if (player2Count == 1) {
          activePlayers[activePlayersIndex] = games[i].player2;
          activePlayersIndex++;
        }
        delete player1Count;
        delete player2Count;
      } else if (games[i].status != Status.CREATED) {
        preActivePlayersIndex++;
        for (uint256 j; j < preActivePlayersIndex; j++) {
          if (preActivePlayers[j] == games[i].player2) {
            player2Count++;
          }
        }
        if (player2Count == 1) {
          activePlayers[activePlayersIndex] = games[i].player2;
          activePlayersIndex++;
        }
        delete player2Count;
      }
    }
    return activePlayers;
  }

  function getEtherBalance() external view returns (uint256) {
    return address(this).balance;
  }

  function _deleteGame(uint256 _gameId) private {
    Game storage game = games[_gameIdToIndex[_gameId]];
    emit GameDeleted(msg.sender, _gameId, game);
    games[_gameIdToIndex[_gameId]] = games[games.length - 1];
    _gameIdToIndex[games[games.length - 1].id] = _gameIdToIndex[_gameId];
    delete _gameIdToIndex[_gameId];
    games.pop();
  }

  function _decryptMove(uint256 _gameId, bytes calldata _seed) private view returns (Game memory) {
    Game memory gameM = games[_gameIdToIndex[_gameId]];
    if (
      keccak256(abi.encodePacked(Hand.ROCK, _seed)) == gameM.encryptedMove ||
      keccak256(abi.encodePacked(_seed, Hand.ROCK)) == gameM.encryptedMove
    ) {
      gameM.decryptedMove = Hand.ROCK;
    } else if (
      keccak256(abi.encodePacked(Hand.PAPER, _seed)) == gameM.encryptedMove ||
      keccak256(abi.encodePacked(_seed, Hand.PAPER)) == gameM.encryptedMove
    ) {
      gameM.decryptedMove = Hand.PAPER;
    } else if (
      keccak256(abi.encodePacked(Hand.SCISSORS, _seed)) == gameM.encryptedMove ||
      keccak256(abi.encodePacked(_seed, Hand.SCISSORS)) == gameM.encryptedMove
    ) {
      gameM.decryptedMove = Hand.SCISSORS;
    } else {
      revert('Decryption failed');
    }
    return gameM;
  }
}
