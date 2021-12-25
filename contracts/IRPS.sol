import '@openzeppelin/contracts/token/ERC20/IERC20.sol';

//SPDX-License-Identifier: Unlicense
pragma solidity >=0.8.4 <0.9.0;

interface IRPS is IERC20 {
  function mint(address, uint256) external;

  function burn(address, uint256) external;
}
